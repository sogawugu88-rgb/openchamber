import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { createProjectConfigRuntime } from '../projects/project-config.js';
import { createTaskboardStore } from './store.js';

const runtimes = [];

const createStore = async () => {
  const projectsDirPath = await mkdtemp(path.join(os.tmpdir(), 'oc-taskboard-store-'));
  const projectConfigRuntime = createProjectConfigRuntime({
    fsPromises: await import('node:fs/promises'),
    path,
    projectsDirPath,
    createTaskID: (() => {
      let next = 0;
      return () => `scheduled-${next += 1}`;
    })(),
  });
  const store = createTaskboardStore({
    projectConfigRuntime,
    createId: (() => {
      let next = 0;
      return () => `task-${next += 1}`;
    })(),
    now: (() => {
      let next = 100;
      return () => next += 100;
    })(),
  });
  const cleanup = async () => rm(projectsDirPath, { recursive: true, force: true });
  runtimes.push(cleanup);
  return { store, projectConfigRuntime, projectsDirPath };
};

afterEach(async () => {
  while (runtimes.length > 0) await runtimes.pop()();
});

describe('taskboard store', () => {
  it('creates a project board without overwriting scheduled tasks', async () => {
    const { store, projectConfigRuntime, projectsDirPath } = await createStore();
    await projectConfigRuntime.upsertScheduledTask('app', {
      name: 'Nightly check',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      execution: {
        prompt: 'Run checks',
        providerID: 'provider',
        modelID: 'model',
      },
    });

    const created = await store.create('app', {
      title: 'Ship board',
      description: 'Build the first taskboard slice.',
      status: 'todo',
      priority: 'high',
    });

    expect(created.task).toMatchObject({
      id: 'task-1',
      identifier: 'APP-1',
      projectId: 'app',
      status: 'todo',
      priority: 'high',
      version: 1,
    });
    expect(created.board.tasks).toHaveLength(1);
    expect(created.board.nextTaskNumber).toBe(2);

    const raw = JSON.parse(await readFile(path.join(projectsDirPath, 'app.json'), 'utf8'));
    expect(raw.scheduledTasks).toHaveLength(1);
    expect(raw.taskboard.tasks).toHaveLength(1);
  });

  it('claims a task only when its version and dependencies are current', async () => {
    const { store } = await createStore();
    const blocker = await store.create('app', { title: 'Blocker', status: 'todo' });
    const blockerClaimed = await store.claimNext('app', blocker.task.id, blocker.task.version, 'blocker-run');
    const blockerReviewed = await store.finishRun('app', blocker.task.id, blockerClaimed.task.version, 'blocker-run', { status: 'success' });
    const blockerDone = await store.move('app', blocker.task.id, blockerReviewed.task.version, 'done');
    const task = await store.create('app', {
      title: 'Worker task',
      status: 'todo',
      blockedBy: [blockerDone.task.identifier],
    });

    const claimed = await store.claimNext('app', task.task.id, task.task.version, 'run-1');
    expect(claimed.claimed).toBe(true);
    expect(claimed.task).toMatchObject({
      id: task.task.id,
      status: 'in_progress',
      runId: 'run-1',
      runStatus: 'starting',
      version: 2,
    });

    await expect(store.claimNext('app', task.task.id, task.task.version, 'run-2'))
      .rejects.toMatchObject({ statusCode: 409, code: 'TASK_VERSION_CONFLICT' });
  });

  it('does not claim a todo task with an unfinished blocker', async () => {
    const { store } = await createStore();
    const blocker = await store.create('app', { title: 'Blocker', status: 'todo' });
    const task = await store.create('app', {
      title: 'Waiting task',
      status: 'todo',
      blockedBy: [blocker.task.identifier],
    });

    const result = await store.claimNext('app', task.task.id, task.task.version, 'run-1');
    expect(result).toEqual({ claimed: false, task: task.task, board: expect.any(Object) });
  });

  it('moves a task through the workflow with a version check', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Review me', status: 'todo' });
    const claimed = await store.claimNext('app', created.task.id, created.task.version, 'run-1');

    const moved = await store.finishRun('app', created.task.id, claimed.task.version, 'run-1', { status: 'success' });
    expect(moved.task.status).toBe('in_review');
    expect(moved.task.version).toBe(3);

    await expect(store.move('app', created.task.id, moved.task.version, 'backlog'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_TRANSITION' });
  });

  it('does not allow a metadata update to bypass the status workflow', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Protected status', status: 'todo' });

    await expect(store.update('app', created.task.id, created.task.version, { status: 'done' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_PATCH' });
  });

  it('keeps task identity server-owned', async () => {
    const { store } = await createStore();

    await expect(store.create('app', {
      id: 'client-task',
      identifier: 'CLIENT-99',
      title: 'Do not spoof identity',
    })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_INPUT' });
  });

  it('does not let manual status changes strand an active run', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Active task', status: 'todo' });
    const claimed = await store.claimNext('app', created.task.id, created.task.version, 'run-1');

    await expect(store.move('app', created.task.id, claimed.task.version, 'todo'))
      .rejects.toMatchObject({ statusCode: 409, code: 'TASK_RUNNING' });
  });

  it('reports malformed task input as a client error', async () => {
    const { store } = await createStore();

    await expect(store.create('app', { description: 'Missing title' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_INPUT' });
  });

  it('does not allow task creation to bypass the worker workflow', async () => {
    const { store } = await createStore();

    await expect(store.create('app', { title: 'Invalid initial state', status: 'in_progress' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_INPUT' });
  });

  it('allows creation only in backlog or todo', async () => {
    const { store } = await createStore();

    await expect(store.create('app', { title: 'Invalid initial status', status: 'done' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TASK_INPUT' });
  });

  it('reserves in-progress transitions for the worker claim path', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Worker-owned state', status: 'todo' });

    await expect(store.move('app', created.task.id, created.task.version, 'in_progress'))
      .rejects.toMatchObject({ statusCode: 409, code: 'TASK_WORKER_ONLY' });
  });

  it('does not allow metadata edits while a run is active', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Active metadata', status: 'todo' });
    const claimed = await store.claimNext('app', created.task.id, created.task.version, 'run-1');

    await expect(store.update('app', created.task.id, claimed.task.version, { title: 'Changed' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'TASK_RUNNING' });
  });

  it('allows only one worker lease per project until it is released', async () => {
    const { store } = await createStore();

    await expect(store.acquireWorkerLease('app', 'worker-a', 10_000)).resolves.toMatchObject({ acquired: true });
    await expect(store.acquireWorkerLease('app', 'worker-b', 10_000)).resolves.toMatchObject({ acquired: false });
    await expect(store.releaseWorkerLease('app', 'worker-b')).resolves.toMatchObject({ released: false });
    await expect(store.releaseWorkerLease('app', 'worker-a')).resolves.toMatchObject({ released: true });
    await expect(store.acquireWorkerLease('app', 'worker-b', 10_000)).resolves.toMatchObject({ acquired: true });
  });

  it('recovers a claimed task without a session as blocked', async () => {
    const { store } = await createStore();
    const created = await store.create('app', { title: 'Orphaned task', status: 'todo' });
    const claimed = await store.claimNext('app', created.task.id, created.task.version, 'run-1');

    const recovered = await store.recoverOrphanedTask(
      'app',
      created.task.id,
      claimed.task.version,
      'Worker stopped before the session was created',
    );

    expect(recovered.task).toMatchObject({
      status: 'blocked',
      runStatus: 'error',
      lastError: 'Worker stopped before the session was created',
      version: 3,
    });
  });
});
