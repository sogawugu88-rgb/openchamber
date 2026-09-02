import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Taskboard, TaskboardAggregate, TaskboardTask } from '@/lib/taskboardApi';

type TaskboardMoveResult = { task: TaskboardTask; board: Taskboard };

type TaskboardHandlers = {
  fetch: () => Promise<Taskboard>;
  move: () => Promise<TaskboardMoveResult>;
  aggregate: () => Promise<TaskboardAggregate>;
};

const handlers = {
  fetch: async (): Promise<Taskboard> => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] }),
  move: async (): Promise<TaskboardMoveResult> => ({ task: task('moved'), board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] } }),
  aggregate: async (): Promise<TaskboardAggregate> => ({
    schemaVersion: 1,
    observedAt: 1,
    complete: true,
    worker: { running: false, projectId: null, taskId: null, sessionId: null },
    projects: [],
  }),
} satisfies TaskboardHandlers;

class MockTaskboardApiError extends Error {
  status = 409;
  code = 'TASK_VERSION_CONFLICT';
}

mock.module('@/lib/taskboardApi', () => ({
  fetchTaskboard: () => handlers.fetch(),
  fetchAllTaskboards: () => handlers.aggregate(),
  setTaskboardAutoRun: async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] }),
  createTaskboardTask: async () => ({ task: null, board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] } }),
  updateTaskboardTask: async () => ({ task: null, board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] } }),
  moveTaskboardTask: () => handlers.move(),
  deleteTaskboardTask: async () => ({ deleted: true, task: task('deleted'), board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] } }),
  runTaskboardTask: async () => ({ skipped: false }),
  TaskboardApiError: MockTaskboardApiError,
}));

const task = (id: string): TaskboardTask => ({
  id,
  identifier: `APP-${id}`,
  projectId: 'app',
  title: id,
  description: '',
  status: 'todo',
  priority: 'none',
  labels: [],
  blockedBy: [],
  sortOrder: 0,
  sessionId: null,
  runId: null,
  runStatus: 'idle',
  runStartedAt: null,
  runFinishedAt: null,
  lastError: null,
  history: [],
    execution: null,
    schedule: null,
    scheduleTemplateId: null,
    scheduledFor: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe('useTaskboardStore', () => {
  beforeEach(() => {
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] });
    handlers.move = async () => ({
      task: task('moved'),
      board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('moved')] },
    });
  });

  test('loads an authoritative board and preserves it when refresh fails', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('one')] });
    await useTaskboardStore.getState().load('app', { force: true });
    expect(useTaskboardStore.getState().getEntry('app').data?.tasks[0]?.id).toBe('one');

    handlers.fetch = async () => { throw new Error('offline'); };
    await expect(useTaskboardStore.getState().load('app', { force: true })).rejects.toThrow('offline');
    expect(useTaskboardStore.getState().getEntry('app').data?.tasks[0]?.id).toBe('one');
    expect(useTaskboardStore.getState().getEntry('app').error).toBe('offline');
  });

  test('accepts a successful empty board as authoritative', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('one')] });
    await useTaskboardStore.getState().load('app', { force: true });
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] });
    await useTaskboardStore.getState().load('app', { force: true });
    expect(useTaskboardStore.getState().getEntry('app').data?.tasks).toEqual([]);
  });

  test('invalidates a cached board without discarding its data', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('one')] });
    await useTaskboardStore.getState().load('app', { force: true });
    useTaskboardStore.getState().invalidate('app');

    expect(useTaskboardStore.getState().getEntry('app').loaded).toBe(false);
    expect(useTaskboardStore.getState().getEntry('app').data?.tasks[0]?.id).toBe('one');
  });

  test('reloads once before retrying a stale status move', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    const staleTask = task('one');
    const freshTask = { ...staleTask, version: 2 };
    handlers.fetch = async () => ({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [freshTask] });
    await useTaskboardStore.getState().load('app', { force: true });
    let moveCalls = 0;
    handlers.move = async () => {
      moveCalls += 1;
      if (moveCalls === 1) throw new MockTaskboardApiError();
      const moved = { ...freshTask, status: 'done' as const, version: 3 };
      return {
        task: moved,
        board: { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [moved] },
      };
    };

    const moved = await useTaskboardStore.getState().move('app', staleTask.id, 1, 'done');

    expect(moveCalls).toBe(2);
    expect(moved.status).toBe('done');
  });

  test('refetches after an in-flight load is invalidated', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    useTaskboardStore.getState().reset();
    let calls = 0;
    let resolveFirst: ((board: Taskboard) => void) | undefined;
    handlers.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Taskboard>((resolve) => { resolveFirst = resolve; });
      }
      return { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('fresh')] };
    };

    const firstLoad = useTaskboardStore.getState().load('app', { force: true });
    useTaskboardStore.getState().invalidate('app');
    const refreshedLoad = useTaskboardStore.getState().load('app', { force: true });
    resolveFirst?.({ version: 1, nextTaskNumber: 1, autoRun: false, tasks: [task('stale')] });
    await firstLoad;
    const refreshed = await refreshedLoad;

    expect(calls).toBe(2);
    expect(refreshed.tasks[0]?.id).toBe('fresh');
  });

  test('loads all project boards and preserves partial project errors', async () => {
    const { useTaskboardStore } = await import('./useTaskboardStore');
    const board = { version: 1, nextTaskNumber: 2, autoRun: true, tasks: [task('one')] };
    handlers.aggregate = async () => ({
      schemaVersion: 1,
      observedAt: 2,
      complete: false,
      worker: { running: false, projectId: null, taskId: null, sessionId: null },
      projects: [
        { projectId: 'app', name: 'App', path: '/repo', state: 'ready', board, error: null },
        { projectId: 'broken', name: 'Broken', path: '/broken', state: 'error', board: null, error: { code: 'TASKBOARD_READ_FAILED', message: 'offline' } },
      ],
    });

    await useTaskboardStore.getState().loadAll();

    expect(useTaskboardStore.getState().getAggregate().data?.complete).toBe(false);
    expect(useTaskboardStore.getState().getEntry('app').data?.tasks[0]?.id).toBe('one');
    expect(useTaskboardStore.getState().getEntry('broken').data).toBeNull();
    expect(useTaskboardStore.getState().getEntry('broken').error).toBe('offline');
  });
});
