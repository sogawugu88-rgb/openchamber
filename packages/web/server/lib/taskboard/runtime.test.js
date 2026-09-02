import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  execution: {
    providerID: 'openai',
    modelID: 'gpt-5.5',
    variant: 'high',
    agent: 'build',
    permissionAutoAccept: true,
    goal: { objective: 'Ship the board' },
  },
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
    listProjects: overrides.listProjects || (async () => [{ id: projectId, path: '/repo' }]),
    openChamberSessionService: {
      create: vi.fn(async () => ({ sessionId, directory: '/repo' })),
      ...(overrides.openChamberSessionService || {}),
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
    expect(taskboardStore.claimNext).toHaveBeenCalledWith(projectId, taskId, 1, expect.any(String), { ignoreSchedule: true });
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

  it('passes task execution settings to the session service', async () => {
    const create = vi.fn(async () => ({ sessionId, directory: '/repo' }));
    const { runtime } = createRuntime({ runtime: { openChamberSessionService: { create } } });

    await runtime.runNow(projectId, taskId);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      providerID: 'openai',
      modelID: 'gpt-5.5',
      variant: 'high',
      agent: 'build',
      permissionAutoAccept: true,
      goal: true,
      goalObjective: 'Ship the board',
    }));
    runtime.stop();
  });

  it('forks from the captured source boundary instead of reusing the source session', async () => {
    const fork = vi.fn(async () => ({ sessionId: 'forked-session', directory: '/repo' }));
    const forkTask = {
      ...task,
      execution: {
        ...task.execution,
        sessionTarget: { mode: 'fork', sourceSessionId: 'source-session', sourceMessageId: 'source-message' },
      },
    };
    const { runtime, taskboardStore } = createRuntime({
      taskboardStore: { list: vi.fn(async () => ({ autoRun: true, tasks: [forkTask] })) },
      openChamberSessionService: { fork },
    });

    await runtime.runNow(projectId, taskId);

    expect(fork).toHaveBeenCalledWith('source-session', expect.objectContaining({
      directory: '/repo',
      messageId: 'source-message',
      prompt: expect.stringContaining('Ship the board'),
    }));
    expect(taskboardStore.setRunSession).toHaveBeenCalledWith(projectId, taskId, 2, 'run-1', 'forked-session');
    runtime.stop();
  });

  it('captures the latest completed source message when creating a fork task', async () => {
    const create = vi.fn(async (_projectId, input) => ({ task: input, board: { autoRun: false, tasks: [] } }));
    const sourceMessages = [
      { info: { id: 'assistant-old', role: 'assistant', time: { completed: 2 } }, parts: [] },
      { info: { id: 'assistant-latest', role: 'assistant', time: { completed: 4 } }, parts: [] },
    ];
    const { runtime } = createRuntime({
      taskboardStore: { create },
      runtime: { fetchSessionMessages: vi.fn(async () => sourceMessages) },
    });

    await runtime.createTask(projectId, {
      title: 'Continue from source',
      execution: {
        ...task.execution,
        sessionTarget: { mode: 'fork', sourceSessionId: 'source-session' },
      },
    });

    expect(create).toHaveBeenCalledWith(projectId, expect.objectContaining({
      execution: expect.objectContaining({
        sessionTarget: { mode: 'fork', sourceSessionId: 'source-session', sourceMessageId: 'assistant-latest' },
      }),
    }));
    runtime.stop();
  });

  it('writes a bounded handoff document before creating a new session', async () => {
    const projectPath = await mkdtemp(path.join(os.tmpdir(), 'oc-taskboard-handoff-'));
    const handoffTask = {
      ...task,
      execution: {
        ...task.execution,
        sessionTarget: {
          mode: 'handoff',
          sourceSessionId: 'source-session',
          handoffPath: '.openchamber/taskboard/handoffs/task.md',
        },
      },
    };
    const create = vi.fn(async () => ({ sessionId: 'handoff-session', directory: projectPath }));
    const { runtime } = createRuntime({
      listProjects: async () => [{ id: projectId, path: projectPath }],
      taskboardStore: { list: vi.fn(async () => ({ autoRun: true, tasks: [handoffTask] })) },
      openChamberSessionService: { create },
    });

    await runtime.runNow(projectId, taskId);

    const content = await readFile(path.join(projectPath, '.openchamber/taskboard/handoffs/task.md'), 'utf8');
    expect(content).toContain('# OpenChamber Taskboard Handoff');
    expect(content).toContain('Ship the board.');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('.openchamber/taskboard/handoffs/task.md'),
    }));
    runtime.stop();
    await rm(projectPath, { recursive: true, force: true });
  });

  it('does not move a Goal task to review while the Goal runtime is still active', async () => {
    let goalStatus = 'active';
    const fetchSessionGoal = vi.fn(async () => ({ available: true, status: goalStatus }));
    const { runtime, taskboardStore } = createRuntime({
      runtime: { fetchSessionGoal, settleDelayMs: 10 },
    });

    await runtime.runNow(projectId, taskId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSessionGoal).toHaveBeenCalledWith(sessionId, '/repo');
    expect(taskboardStore.finishRun).not.toHaveBeenCalled();

    goalStatus = 'complete';
    runtime.processPayload(idleEvent(), '/repo');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(taskboardStore.finishRun).toHaveBeenCalled();
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

  it('lists all project boards with isolated read failures', async () => {
    const list = vi.fn(async (projectID) => {
      if (projectID === 'broken') throw new Error('offline');
      return { autoRun: false, tasks: [] };
    });
    const acquireWorkerLease = vi.fn();
    const renewWorkerLease = vi.fn();
    const releaseWorkerLease = vi.fn();
    const { runtime } = createRuntime({
      listProjects: async () => [
        { id: 'app', label: 'App', path: '/repo' },
        { id: 'broken', label: 'Broken', path: '/broken' },
      ],
      taskboardStore: { list, acquireWorkerLease, renewWorkerLease, releaseWorkerLease },
    });

    const result = await runtime.listAll();

    expect(result.complete).toBe(false);
    expect(result.projects).toEqual([
      {
        projectId: 'app',
        name: 'App',
        path: '/repo',
        state: 'ready',
        board: { autoRun: false, tasks: [] },
        error: null,
      },
      {
        projectId: 'broken',
        name: 'Broken',
        path: '/broken',
        state: 'error',
        board: null,
        error: { code: 'TASKBOARD_READ_FAILED', message: 'offline' },
      },
    ]);
    expect(result.worker).toEqual({ running: false, projectId: null, taskId: null, sessionId: null });
    expect(acquireWorkerLease).not.toHaveBeenCalled();
    expect(renewWorkerLease).not.toHaveBeenCalled();
    expect(releaseWorkerLease).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('propagates project-list failures instead of returning an empty aggregate', async () => {
    const { runtime } = createRuntime({
      listProjects: async () => { throw new Error('settings offline'); },
    });

    await expect(runtime.listAll()).rejects.toThrow('settings offline');
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
