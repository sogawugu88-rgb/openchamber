import { create } from 'zustand';

import {
  createTaskboardTask,
  deleteTaskboardTask,
  fetchAllTaskboards,
  fetchTaskboard,
  moveTaskboardTask,
  runTaskboardTask,
  setTaskboardAutoRun,
  updateTaskboardTask,
  TaskboardApiError,
  type Taskboard,
  type TaskboardAggregate,
  type TaskboardTaskInput,
  type TaskboardTaskPatch,
  type TaskboardTask,
  type TaskboardStatus,
} from '@/lib/taskboardApi';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

type TaskboardEntry = {
  data: Taskboard | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  revision: number;
};

type TaskboardAggregateEntry = {
  data: TaskboardAggregate | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  revision: number;
};

type EntryMap = { [key: string]: TaskboardEntry };

type TaskboardState = {
  entries: EntryMap;
  aggregate: TaskboardAggregateEntry;
  getAggregate: () => TaskboardAggregateEntry;
  getEntry: (projectId: string | null | undefined) => TaskboardEntry;
  load: (projectId: string, options?: { force?: boolean }) => Promise<Taskboard>;
  loadAll: (options?: { force?: boolean }) => Promise<TaskboardAggregate>;
  create: (projectId: string, input: TaskboardTaskInput) => Promise<TaskboardTask>;
  update: (projectId: string, taskId: string, version: number, patch: TaskboardTaskPatch) => Promise<TaskboardTask>;
  move: (projectId: string, taskId: string, version: number, status: TaskboardStatus) => Promise<TaskboardTask>;
  remove: (projectId: string, taskId: string, version: number) => Promise<void>;
  setAutoRun: (projectId: string, enabled: boolean) => Promise<Taskboard>;
  runNow: (projectId: string, taskId: string) => Promise<void>;
  invalidate: (projectId: string) => void;
  reset: () => void;
};

const EMPTY_TASKBOARD_ENTRY: TaskboardEntry = {
  data: null,
  loaded: false,
  loading: false,
  error: null,
  revision: 0,
};

const EMPTY_TASKBOARD_AGGREGATE_ENTRY: TaskboardAggregateEntry = {
  data: null,
  loaded: false,
  loading: false,
  error: null,
  revision: 0,
};

const inFlight = new Map<string, { promise: Promise<Taskboard>; revision: number }>();
let aggregateInFlight: { promise: Promise<TaskboardAggregate>; revision: number } | null = null;

const errorMessage = (error: Error | null, fallback: string): string => (
  error?.message || fallback
);

const entryKey = (projectId: string): string => `${getRuntimeKey()}:${projectId}`;

const normalizeProjectId = (projectId: string): string => {
  const normalized = projectId.trim();
  if (!normalized) throw new Error('projectId is required');
  return normalized;
};

const patchEntry = (set: (updater: (state: TaskboardState) => Partial<TaskboardState>) => void, key: string, patch: Partial<TaskboardEntry>) => {
  set((state) => ({
    entries: {
      ...state.entries,
      [key]: { ...(state.entries[key] || EMPTY_TASKBOARD_ENTRY), ...patch },
    },
  }));
};

const patchAggregate = (set: (updater: (state: TaskboardState) => Partial<TaskboardState>) => void, patch: Partial<TaskboardAggregateEntry>) => {
  set((state) => ({ aggregate: { ...state.aggregate, ...patch } }));
};

const patchAggregateProject = (set: (updater: (state: TaskboardState) => Partial<TaskboardState>) => void, projectId: string, board: Taskboard) => {
  set((state) => {
    if (!state.aggregate.data) return {};
    const projects = state.aggregate.data.projects.map((project) => (
      project.projectId === projectId
        ? { ...project, state: 'ready' as const, board, error: null }
        : project
    ));
    return {
      aggregate: {
        ...state.aggregate,
        data: {
          ...state.aggregate.data,
          complete: projects.every((project) => project.state === 'ready'),
          projects,
        },
      },
    };
  });
};

const applyAggregate = (set: (updater: (state: TaskboardState) => Partial<TaskboardState>) => void, data: TaskboardAggregate) => {
  set((state) => {
    const entries = { ...state.entries };
    for (const project of data.projects) {
      const key = entryKey(project.projectId);
      const current = entries[key] || EMPTY_TASKBOARD_ENTRY;
      entries[key] = {
        ...current,
        data: project.state === 'ready' ? project.board : current.data,
        loaded: project.state === 'ready' ? true : current.loaded,
        loading: false,
        error: project.error?.message || null,
      };
    }
    return {
      entries,
      aggregate: {
        ...state.aggregate,
        data,
        loaded: true,
        loading: false,
        error: null,
      },
    };
  });
};

export const useTaskboardStore = create<TaskboardState>((set, get) => ({
  entries: {},

  aggregate: EMPTY_TASKBOARD_AGGREGATE_ENTRY,

  getAggregate: () => get().aggregate,

  getEntry: (projectId) => {
    if (!projectId?.trim()) return EMPTY_TASKBOARD_ENTRY;
    return get().entries[entryKey(projectId.trim())] || EMPTY_TASKBOARD_ENTRY;
  },

  load: async (projectId, options = {}) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const key = entryKey(normalizedProjectId);
    const current = get().entries[key] || EMPTY_TASKBOARD_ENTRY;
    if (current.loaded && !options.force) return current.data || { version: 1, nextTaskNumber: 1, autoRun: false, tasks: [] };

    const existing = inFlight.get(key);
    if (existing) {
      if (existing.revision === current.revision) return existing.promise;
      await existing.promise.catch(() => undefined);
      return get().load(normalizedProjectId, { force: true });
    }

    patchEntry(set, key, { loading: true, error: null });
    const runtimeAtStart = getRuntimeKey();
    const revisionAtStart = get().entries[key]?.revision ?? 0;
    const request = fetchTaskboard(normalizedProjectId);
    inFlight.set(key, { promise: request, revision: revisionAtStart });

    try {
      const data = await request;
      if (runtimeAtStart === getRuntimeKey() && get().entries[key]?.revision === revisionAtStart) {
        patchEntry(set, key, { data, loaded: true, loading: false, error: null });
        patchAggregateProject(set, normalizedProjectId, data);
      } else if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { loading: false });
      }
      return data;
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey() && get().entries[key]?.revision === revisionAtStart) {
        patchEntry(set, key, {
          loading: false,
          error: errorMessage(error instanceof Error ? error : null, 'Failed to load taskboard'),
        });
      } else if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { loading: false });
      }
      throw error;
    } finally {
      if (inFlight.get(key)?.promise === request) inFlight.delete(key);
    }
  },

  loadAll: async (options = {}) => {
    const current = get().aggregate;
    if (current.loaded && !options.force && current.data) return current.data;

    if (aggregateInFlight) {
      if (aggregateInFlight.revision === current.revision) return aggregateInFlight.promise;
      await aggregateInFlight.promise.catch(() => undefined);
      return get().loadAll({ force: true });
    }

    patchAggregate(set, { loading: true, error: null });
    const runtimeAtStart = getRuntimeKey();
    const revisionAtStart = get().aggregate.revision;
    const request = fetchAllTaskboards();
    aggregateInFlight = { promise: request, revision: revisionAtStart };

    try {
      const data = await request;
      if (runtimeAtStart === getRuntimeKey() && get().aggregate.revision === revisionAtStart) {
        applyAggregate(set, data);
      }
      return data;
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey() && get().aggregate.revision === revisionAtStart) {
        patchAggregate(set, {
          loading: false,
          error: errorMessage(error instanceof Error ? error : null, 'Failed to load all taskboards'),
        });
      }
      throw error;
    } finally {
      if (aggregateInFlight?.promise === request) aggregateInFlight = null;
    }
  },

  create: async (projectId, input) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const result = await createTaskboardTask(normalizedProjectId, input);
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { data: result.board, loaded: true, error: null });
        patchAggregateProject(set, normalizedProjectId, result.board);
      }
      return result.task;
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to create task') });
      }
      throw error;
    }
  },

  update: async (projectId, taskId, version, patch) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const result = await updateTaskboardTask(normalizedProjectId, taskId, version, patch);
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { data: result.board, loaded: true, error: null });
        patchAggregateProject(set, normalizedProjectId, result.board);
      }
      return result.task;
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to update task') });
      }
      throw error;
    }
  },

  move: async (projectId, taskId, version, status) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const result = await moveTaskboardTask(normalizedProjectId, taskId, version, status);
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { data: result.board, loaded: true, error: null });
        patchAggregateProject(set, normalizedProjectId, result.board);
      }
      return result.task;
    } catch (error) {
      if (error instanceof TaskboardApiError && error.status === 409 && runtimeAtStart === getRuntimeKey()) {
        try {
          await get().load(normalizedProjectId, { force: true });
          if (runtimeAtStart === getRuntimeKey()) {
            const current = get().entries[key]?.data?.tasks.find((task) => task.id === taskId);
            if (current && current.status !== status) {
              const retry = await moveTaskboardTask(normalizedProjectId, taskId, current.version, status);
              if (runtimeAtStart === getRuntimeKey()) {
                patchEntry(set, key, { data: retry.board, loaded: true, error: null });
                patchAggregateProject(set, normalizedProjectId, retry.board);
              }
              return retry.task;
            }
            if (current?.status === status) return current;
          }
        } catch (retryError) {
          if (runtimeAtStart === getRuntimeKey()) {
            patchEntry(set, key, { error: errorMessage(retryError instanceof Error ? retryError : null, 'Failed to move task') });
          }
          throw retryError;
        }
      }
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to move task') });
      }
      throw error;
    }
  },

  remove: async (projectId, taskId, version) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const result = await deleteTaskboardTask(normalizedProjectId, taskId, version);
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { data: result.board, loaded: true, error: null });
        patchAggregateProject(set, normalizedProjectId, result.board);
      }
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to delete task') });
      }
      throw error;
    }
  },

  setAutoRun: async (projectId, enabled) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const board = await setTaskboardAutoRun(normalizedProjectId, enabled);
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { data: board, loaded: true, error: null });
        patchAggregateProject(set, normalizedProjectId, board);
      }
      return board;
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to update taskboard settings') });
      }
      throw error;
    }
  },

  runNow: async (projectId, taskId) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const runtimeAtStart = getRuntimeKey();
    const key = entryKey(normalizedProjectId);
    try {
      const result = await runTaskboardTask(normalizedProjectId, taskId);
      if (result.skipped || result.ok === false) {
        throw new Error(result.error || result.reason || 'Task is not ready to run');
      }
      if (runtimeAtStart === getRuntimeKey()) {
        await get().load(normalizedProjectId, { force: true });
      }
    } catch (error) {
      if (runtimeAtStart === getRuntimeKey()) {
        patchEntry(set, key, { error: errorMessage(error instanceof Error ? error : null, 'Failed to run task') });
      }
      throw error;
    }
  },

  invalidate: (projectId) => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const key = entryKey(normalizedProjectId);
    const current = get().entries[key];
    if (!current) return;
    patchEntry(set, key, { loaded: false, revision: current.revision + 1 });
  },

  reset: () => {
    inFlight.clear();
    aggregateInFlight = null;
    set({ entries: {}, aggregate: EMPTY_TASKBOARD_AGGREGATE_ENTRY });
  },
}));

subscribeRuntimeEndpointChanged(() => {
  inFlight.clear();
  aggregateInFlight = null;
  useTaskboardStore.setState({ entries: {}, aggregate: EMPTY_TASKBOARD_AGGREGATE_ENTRY });
});
