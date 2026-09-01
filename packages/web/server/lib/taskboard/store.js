import {
  appendTaskHistory,
  canTransitionTaskStatus,
  getEligibleTasks,
  normalizeTask,
} from './domain.js';

const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

const asNonEmptyString = (value) => {
  if (!isString(value)) return null;
  const normalized = value.trim();
  return normalized || null;
};

const nowValue = (now) => {
  const value = isFunction(now) ? now() : Date.now();
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : Date.now();
};

const taskIdentifierPrefix = (projectId) => {
  const prefix = projectId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12);
  return prefix || 'TASK';
};

const TASK_PATCH_FIELDS = new Set(['title', 'description', 'priority', 'labels', 'blockedBy', 'sortOrder']);
const TASK_CREATE_FIELDS = new Set(['title', 'description', 'status', 'priority', 'labels', 'blockedBy']);

class TaskboardStoreError extends Error {
  constructor(message, statusCode, code, task = null) {
    super(message);
    this.name = 'TaskboardStoreError';
    this.statusCode = statusCode;
    this.code = code;
    this.task = task;
  }
}

const conflict = (task) => new TaskboardStoreError(
  `Task version conflict for ${task.identifier}`,
  409,
  'TASK_VERSION_CONFLICT',
  task,
);

const notFound = (taskId) => new TaskboardStoreError(
  `Task not found: ${taskId}`,
  404,
  'TASK_NOT_FOUND',
);

const assertVersion = (task, version) => {
  if (!Number.isSafeInteger(version) || version < 1 || task.version !== version) {
    throw conflict(task);
  }
};

const assertPatchObject = (patch) => {
  if (!isRecord(patch)) {
    throw new TaskboardStoreError('Task patch must be an object', 400, 'INVALID_TASK_PATCH');
  }
  const invalidField = Object.keys(patch).find((field) => !TASK_PATCH_FIELDS.has(field));
  if (invalidField) {
    throw new TaskboardStoreError(`Task field cannot be updated directly: ${invalidField}`, 400, 'INVALID_TASK_PATCH');
  }
};

const assertCreateObject = (input) => {
  if (!isRecord(input)) {
    throw new TaskboardStoreError('Task input must be an object', 400, 'INVALID_TASK_INPUT');
  }
  const invalidField = Object.keys(input).find((field) => !TASK_CREATE_FIELDS.has(field));
  if (invalidField) {
    throw new TaskboardStoreError(`Task field cannot be supplied: ${invalidField}`, 400, 'INVALID_TASK_INPUT');
  }
  if (input.status !== undefined && input.status !== 'backlog' && input.status !== 'todo') {
    throw new TaskboardStoreError('New tasks must start in backlog or todo', 400, 'INVALID_TASK_INPUT');
  }
};

export const createTaskboardStore = ({ projectConfigRuntime, createId, now } = {}) => {
  if (!projectConfigRuntime || !projectConfigRuntime.readTaskboard || !projectConfigRuntime.mutateTaskboard) {
    throw new Error('projectConfigRuntime with taskboard support is required');
  }

  const idFactory = isFunction(createId)
    ? createId
    : () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const list = async (projectId) => projectConfigRuntime.readTaskboard(projectId);

  const get = async (projectId, taskId) => {
    const board = await list(projectId);
    return board.tasks.find((task) => task.id === taskId) || null;
  };

  const create = async (projectId, input = {}) => {
    const normalizedProjectId = asNonEmptyString(projectId);
    if (!normalizedProjectId) {
      throw new TaskboardStoreError('projectId is required', 400, 'PROJECT_ID_REQUIRED');
    }
    assertCreateObject(input);

    const mutation = await projectConfigRuntime.mutateTaskboard(normalizedProjectId, (current) => {
      const timestamp = nowValue(now);
      const number = current.nextTaskNumber;
      let task;
      try {
        task = normalizeTask({
          ...input,
          id: idFactory(),
          identifier: `${taskIdentifierPrefix(normalizedProjectId)}-${number}`,
          projectId: normalizedProjectId,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }, {
          projectId: normalizedProjectId,
          now: timestamp,
          createId: idFactory,
        });
      } catch (error) {
        throw new TaskboardStoreError(
          error instanceof Error ? error.message : 'Invalid task input',
          400,
          'INVALID_TASK_INPUT',
        );
      }

      return {
        taskboard: {
          ...current,
          nextTaskNumber: number + 1,
          tasks: [...current.tasks, task],
        },
        result: task,
      };
    });
    return { task: mutation.result, board: mutation.taskboard };
  };

  const update = async (projectId, taskId, version, patch) => {
    assertPatchObject(patch);
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const index = current.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw notFound(taskId);
      const existing = current.tasks[index];
      assertVersion(existing, version);
      if (existing.runStatus === 'starting' || existing.runStatus === 'running') {
        throw new TaskboardStoreError('Running tasks cannot be edited', 409, 'TASK_RUNNING', existing);
      }
      const timestamp = nowValue(now);
      const nextTask = normalizeTask({
        ...existing,
        ...patch,
        id: existing.id,
        projectId: existing.projectId,
        version: existing.version + 1,
        createdAt: existing.createdAt,
        updatedAt: timestamp,
      }, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const changedFields = Object.keys(patch).filter((field) => field !== 'id' && field !== 'projectId');
      const withHistory = appendTaskHistory(nextTask, {
        type: 'update',
        fields: changedFields,
        at: timestamp,
      });
      const tasks = current.tasks.slice();
      tasks[index] = withHistory;
      return { taskboard: { ...current, tasks }, result: withHistory };
    });
    return { task: mutation.result, board: mutation.taskboard };
  };

  const move = async (projectId, taskId, version, status) => {
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const index = current.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw notFound(taskId);
      const existing = current.tasks[index];
      assertVersion(existing, version);
      if (existing.status === status) return { taskboard: current, result: existing };
      if (status === 'in_progress') {
        throw new TaskboardStoreError('Only the task worker can claim a task', 409, 'TASK_WORKER_ONLY', existing);
      }
      if (existing.runStatus === 'starting' || existing.runStatus === 'running') {
        throw new TaskboardStoreError('Running tasks cannot be moved manually', 409, 'TASK_RUNNING', existing);
      }
      if (!canTransitionTaskStatus(existing.status, status)) {
        throw new TaskboardStoreError(
          `Cannot move task from ${existing.status} to ${status}`,
          400,
          'INVALID_TASK_TRANSITION',
          existing,
        );
      }

      const timestamp = nowValue(now);
      const taskInput = {
        ...existing,
        status,
        version: existing.version + 1,
        updatedAt: timestamp,
      };
      if (status === 'todo') {
        Object.assign(taskInput, {
          runId: null,
          runStatus: 'idle',
          runStartedAt: null,
          runFinishedAt: null,
          lastError: null,
        });
      }
      const nextTask = normalizeTask(taskInput, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const withHistory = appendTaskHistory(nextTask, {
        type: 'status',
        from: existing.status,
        status,
        at: timestamp,
      });
      const tasks = current.tasks.slice();
      tasks[index] = withHistory;
      return { taskboard: { ...current, tasks }, result: withHistory };
    });
    return { task: mutation.result, board: mutation.taskboard };
  };

  const remove = async (projectId, taskId, version) => {
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const existing = current.tasks.find((task) => task.id === taskId);
      if (!existing) throw notFound(taskId);
      assertVersion(existing, version);
      if (existing.runStatus === 'starting' || existing.runStatus === 'running') {
        throw new TaskboardStoreError('Running tasks cannot be deleted', 409, 'TASK_RUNNING', existing);
      }
      return {
        taskboard: {
          ...current,
          tasks: current.tasks.filter((task) => task.id !== taskId),
        },
        result: { deleted: true, task: existing },
      };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  const setAutoRun = async (projectId, enabled) => {
    if (enabled !== true && enabled !== false) {
      throw new TaskboardStoreError('autoRun must be a boolean', 400, 'INVALID_AUTORUN');
    }
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => ({
      taskboard: { ...current, autoRun: enabled },
      result: enabled,
    }));
    return { enabled: mutation.result, board: mutation.taskboard };
  };

  const acquireWorkerLease = async (projectId, ownerId, leaseMs) => {
    const normalizedOwnerId = asNonEmptyString(ownerId);
    if (!normalizedOwnerId) {
      throw new TaskboardStoreError('ownerId is required', 400, 'OWNER_ID_REQUIRED');
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new TaskboardStoreError('leaseMs must be a positive integer', 400, 'INVALID_LEASE');
    }

    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const timestamp = nowValue(now);
      const existing = current.workerLease;
      if (existing && existing.ownerId !== normalizedOwnerId && existing.expiresAt > timestamp) {
        return { taskboard: current, result: { acquired: false, lease: existing } };
      }
      const lease = { ownerId: normalizedOwnerId, expiresAt: timestamp + leaseMs };
      return {
        taskboard: { ...current, workerLease: lease },
        result: { acquired: true, lease },
      };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  const renewWorkerLease = async (projectId, ownerId, leaseMs) => {
    const normalizedOwnerId = asNonEmptyString(ownerId);
    if (!normalizedOwnerId) {
      throw new TaskboardStoreError('ownerId is required', 400, 'OWNER_ID_REQUIRED');
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
      throw new TaskboardStoreError('leaseMs must be a positive integer', 400, 'INVALID_LEASE');
    }

    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const timestamp = nowValue(now);
      if (current.workerLease?.ownerId !== normalizedOwnerId || current.workerLease.expiresAt <= timestamp) {
        return { taskboard: current, result: { renewed: false } };
      }
      const lease = { ownerId: normalizedOwnerId, expiresAt: timestamp + leaseMs };
      return {
        taskboard: { ...current, workerLease: lease },
        result: { renewed: true, lease },
      };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  const releaseWorkerLease = async (projectId, ownerId) => {
    const normalizedOwnerId = asNonEmptyString(ownerId);
    if (!normalizedOwnerId) {
      throw new TaskboardStoreError('ownerId is required', 400, 'OWNER_ID_REQUIRED');
    }

    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      if (current.workerLease?.ownerId !== normalizedOwnerId) {
        return { taskboard: current, result: { released: false } };
      }
      return {
        taskboard: { ...current, workerLease: null },
        result: { released: true },
      };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  const claimNext = async (projectId, taskId, version, runId) => {
    const normalizedRunId = asNonEmptyString(runId);
    if (!normalizedRunId) {
      throw new TaskboardStoreError('runId is required', 400, 'RUN_ID_REQUIRED');
    }

    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const existing = current.tasks.find((task) => task.id === taskId);
      if (!existing) throw notFound(taskId);
      assertVersion(existing, version);
      if (existing.status !== 'todo') return { taskboard: current, result: { claimed: false, task: existing } };
      if (!getEligibleTasks(current.tasks).some((task) => task.id === taskId)) {
        return { taskboard: current, result: { claimed: false, task: existing } };
      }

      const timestamp = nowValue(now);
      const claimed = normalizeTask({
        ...existing,
        status: 'in_progress',
        runId: normalizedRunId,
        runStatus: 'starting',
        runStartedAt: timestamp,
        runFinishedAt: null,
        lastError: null,
        version: existing.version + 1,
        updatedAt: timestamp,
      }, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const withHistory = appendTaskHistory(claimed, {
        type: 'claim',
        runId: normalizedRunId,
        at: timestamp,
      });
      const tasks = current.tasks.map((task) => task.id === taskId ? withHistory : task);
      return {
        taskboard: { ...current, tasks },
        result: { claimed: true, task: withHistory },
      };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  const setRunSession = async (projectId, taskId, version, runId, sessionId) => {
    const normalizedSessionId = asNonEmptyString(sessionId);
    if (!normalizedSessionId) {
      throw new TaskboardStoreError('sessionId is required', 400, 'SESSION_ID_REQUIRED');
    }
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const index = current.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw notFound(taskId);
      const existing = current.tasks[index];
      assertVersion(existing, version);
      if (existing.runId !== runId) throw conflict(existing);
      const timestamp = nowValue(now);
      const nextTask = normalizeTask({
        ...existing,
        sessionId: normalizedSessionId,
        runStatus: 'running',
        version: existing.version + 1,
        updatedAt: timestamp,
      }, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const tasks = current.tasks.slice();
      tasks[index] = nextTask;
      return { taskboard: { ...current, tasks }, result: nextTask };
    });
    return { task: mutation.result, board: mutation.taskboard };
  };

  const finishRun = async (projectId, taskId, version, runId, outcome) => {
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const index = current.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw notFound(taskId);
      const existing = current.tasks[index];
      assertVersion(existing, version);
      if (existing.runId !== runId) throw conflict(existing);
      const status = outcome?.status === 'success' ? 'in_review' : 'blocked';
      const runStatus = outcome?.status === 'success' ? 'success' : 'error';
      const timestamp = nowValue(now);
      const sessionId = asNonEmptyString(outcome?.sessionId) || existing.sessionId;
      const nextTask = normalizeTask({
        ...existing,
        status,
        runStatus,
        sessionId,
        runFinishedAt: timestamp,
        lastError: outcome?.status === 'success' ? null : asNonEmptyString(outcome?.error),
        version: existing.version + 1,
        updatedAt: timestamp,
      }, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const withHistory = appendTaskHistory(nextTask, {
        type: 'run',
        runId,
        status: runStatus,
        error: nextTask.lastError,
        at: timestamp,
      });
      const tasks = current.tasks.slice();
      tasks[index] = withHistory;
      return { taskboard: { ...current, tasks }, result: withHistory };
    });
    return { task: mutation.result, board: mutation.taskboard };
  };

  const recoverOrphanedTask = async (projectId, taskId, version, error) => {
    const mutation = await projectConfigRuntime.mutateTaskboard(projectId, (current) => {
      const index = current.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) throw notFound(taskId);
      const existing = current.tasks[index];
      assertVersion(existing, version);
      if (existing.status !== 'in_progress') {
        return { taskboard: current, result: { recovered: false, task: existing } };
      }
      const timestamp = nowValue(now);
      const nextTask = normalizeTask({
        ...existing,
        status: 'blocked',
        runStatus: 'error',
        runFinishedAt: timestamp,
        lastError: asNonEmptyString(error) || 'Worker stopped before the task run completed',
        version: existing.version + 1,
        updatedAt: timestamp,
      }, { projectId: existing.projectId, now: timestamp, createId: idFactory });
      const withHistory = appendTaskHistory(nextTask, {
        type: 'run',
        runId: existing.runId,
        status: 'error',
        error: nextTask.lastError,
        at: timestamp,
      });
      const tasks = current.tasks.slice();
      tasks[index] = withHistory;
      return { taskboard: { ...current, tasks }, result: { recovered: true, task: withHistory } };
    });
    return { ...mutation.result, board: mutation.taskboard };
  };

  return {
    list,
    get,
    create,
    update,
    move,
    remove,
    setAutoRun,
    acquireWorkerLease,
    renewWorkerLease,
    releaseWorkerLease,
    claimNext,
    setRunSession,
    finishRun,
    recoverOrphanedTask,
  };
};
