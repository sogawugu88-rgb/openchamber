import { describe, expect, it, vi } from 'vitest';

import { createTaskboardRuntime } from './runtime.js';

const projectId = 'app';
const taskId = 'task-1';
const sessionId = 'ses-task-1';

const task = {
  id: taskId,
  identifier: 'APP-1',
  projectId,
  title: 'Ship the board',
  description: 'Build the first taskboard slice.',
  status: 'todo',
  priority: 'high',
  blockedBy: [],
  sessionId: null,
  runId: null,
  runStatus: 'idle',
  version: 1,
};

const userMessage = () => ({
  info: {
    id: 'user-1',
    sessionID: sessionId,
    role: 'user',
    time: { created: 1 },
  },
  parts: [{ type: 'text', text: 'Ship the board.' }],
});

const assistantMessage = (error = null) => ({
  info: {
    id: 'assistant-1',
    sessionID: sessionId,
    parentID: 'user-1',
    role: 'assistant',
    time: { created: 2, completed: 3 },
    ...(error ? { error } : {}),
  },
  parts: [],
});

const idleEvent = () => ({
  type: 'session.status',
  properties: {
    sessionID: sessionId,
    directory: '/repo',
    status: { type: 'idle' },
  },
});

const createRuntime = (overrides = {}) => {
  const claimedTask = {
    ...task,
    status: 'in_progress',
    runId: 'run-1',
    runStatus: 'starting',
    version: 2,
  };
  const runningTask = { ...claimedTask, sessionId, runStatus: 'running', version: 3 };
  const taskboardStore = {
    list: vi.fn(async () => ({ autoRun: true, tasks: [task] })),
    claimNext: vi.fn(async () => ({ claimed: true, task: claimedTask, board: { autoRun: true, tasks: [claimedTask] } })),
    setRunSession: vi.fn(async () => ({ task: runningTask, board: { autoRun: true, tasks: [runningTask] } })),
    finishRun: vi.fn(async (_projectID, _taskID, _version, _runID, outcome) => ({
      task: {
        ...runningTask,
        status: outcome.status === 'success' ? 'in_review' : 'blocked',
        runStatus: outcome.status === 'success' ? 'success' : 'error',
        version: 4,
      },
      board: { autoRun: true, tasks: [] },
    })),
    ...(overrides.taskboardStore || {}),
  };
  const runtime = createTaskboardRuntime({
    taskboardStore,
    listProjects: async () => [{ id: projectId, path: '/repo' }],
    openChamberSessionService: {
      create: vi.fn(async () => ({ sessionId, directory: '/repo' })),
    },
    fetchSessionMessages: vi.fn(async () => [userMessage(), assistantMessage()]),
    emitTaskboardEvent: vi.fn(),
    pollIntervalMs: 60_000,
    settleDelayMs: 0,
    createRunId: () => 'run-1',
    ...(overrides.runtime || {}),
  });
  return { runtime, taskboardStore };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

describe('taskboard runtime', () => {
  it('claims a task, creates an independent session, and moves success to review', async () => {
    const { runtime, taskboardStore } = createRuntime();

    const result = await runtime.runNow(projectId, taskId);
    expect(result).toMatchObject({ sessionId, taskId });
    expect(taskboardStore.claimNext).toHaveBeenCalledWith(projectId, taskId, 1, expect.any(String));
    expect(taskboardStore.setRunSession).toHaveBeenCalledWith(projectId, taskId, 2, 'run-1', sessionId);

    runtime.processPayload(idleEvent(), '/repo');
    await flush();

    expect(taskboardStore.finishRun).toHaveBeenCalledWith(
      projectId,
      taskId,
      3,
      'run-1',
      { status: 'success' },
    );
    runtime.stop();
  });

  it('moves a failed assistant turn to blocked', async () => {
    const { runtime, taskboardStore } = createRuntime({
      runtime: {
        fetchSessionMessages: vi.fn(async () => [userMessage(), assistantMessage({ name: 'APIError', message: 'Provider failed' })]),
      },
    });

    await runtime.runNow(projectId, taskId);
    runtime.processPayload(idleEvent(), '/repo');
    await flush();

    expect(taskboardStore.finishRun).toHaveBeenCalledWith(
      projectId,
      taskId,
      3,
      'run-1',
      { status: 'error', error: 'Provider failed' },
    );
    runtime.stop();
  });

  it('does not dispatch a second task while one task is active', async () => {
    const { runtime, taskboardStore } = createRuntime();

    const first = await runtime.runNow(projectId, taskId);
    const second = await runtime.runNow(projectId, taskId);

    expect(first.sessionId).toBe(sessionId);
    expect(second).toMatchObject({ skipped: true, reason: 'worker-busy' });
    expect(taskboardStore.claimNext).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('wakes the worker when an enabled board starts', async () => {
    const { runtime, taskboardStore } = createRuntime();

    await runtime.start();
    await flush();

    expect(taskboardStore.claimNext).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('rejects taskboard access for an unknown project', async () => {
    const { runtime } = createRuntime();

    await expect(runtime.list('missing'))
      .rejects.toMatchObject({ statusCode: 404, code: 'PROJECT_NOT_FOUND' });
    runtime.stop();
  });

  it('records an authoritative session error as a blocked task', async () => {
    const { runtime, taskboardStore } = createRuntime();

    await runtime.runNow(projectId, taskId);
    runtime.processPayload({
      type: 'session.error',
      properties: {
        sessionID: sessionId,
        error: { name: 'MessageAbortedError', message: 'OpenCode restarted' },
      },
    }, '/repo');
    await flush();

    expect(taskboardStore.finishRun).toHaveBeenCalledWith(
      projectId,
      taskId,
      3,
      'run-1',
      { status: 'error', error: 'OpenCode restarted' },
    );
    runtime.stop();
  });

  it('blocks a run that never records its prompt', async () => {
    const { runtime, taskboardStore } = createRuntime({
      runtime: {
        openChamberSessionService: {
          create: vi.fn(async () => ({
            sessionId,
            directory: '/repo',
            promptDispatched: false,
            promptError: 'Prompt was not recorded',
          })),
        },
      },
    });

    const result = await runtime.runNow(projectId, taskId);

    expect(result).toMatchObject({ ok: false, error: 'Prompt was not recorded' });
    expect(taskboardStore.finishRun).toHaveBeenCalledWith(
      projectId,
      taskId,
      3,
      'run-1',
      { status: 'error', error: 'Prompt was not recorded', sessionId },
    );
    runtime.stop();
  });

  it('blocks a run after its terminal watchdog expires', async () => {
    const { runtime, taskboardStore } = createRuntime({
      runtime: { maxRunDurationMs: 0 },
    });

    await runtime.runNow(projectId, taskId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(taskboardStore.finishRun).toHaveBeenCalledWith(
      projectId,
      taskId,
      3,
      'run-1',
      { status: 'error', error: 'Task run timed out' },
    );
    runtime.stop();
  });

  it('reattaches a persisted session instead of creating a duplicate', async () => {
    const persistedTask = {
      ...task,
      status: 'in_progress',
      runId: 'run-old',
      sessionId: 'ses-old',
      runStatus: 'running',
      runStartedAt: 1,
      version: 3,
    };
    const acquireWorkerLease = vi.fn(async () => ({ acquired: true }));
    const releaseWorkerLease = vi.fn(async () => ({ released: true }));
    const { runtime, taskboardStore } = createRuntime({
      taskboardStore: {
        list: vi.fn(async () => ({ autoRun: false, tasks: [persistedTask] })),
        acquireWorkerLease,
        releaseWorkerLease,
      },
      runtime: {
        fetchSessionStatus: vi.fn(async () => ({ type: 'busy' })),
      },
    });

    await runtime.start();

    expect(acquireWorkerLease).toHaveBeenCalledWith('app', expect.any(String), expect.any(Number));
    expect(taskboardStore.claimNext).not.toHaveBeenCalled();
    expect(taskboardStore.setRunSession).not.toHaveBeenCalled();
    runtime.stop();
    expect(releaseWorkerLease).toHaveBeenCalled();
  });
});
