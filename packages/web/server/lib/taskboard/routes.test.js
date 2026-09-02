import { describe, expect, it, vi } from 'vitest';

import { registerTaskboardRoutes } from './routes.js';

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const captureHandlers = (taskboardRuntime) => {
  const handlers = new Map();
  const app = {
    get: vi.fn((route, ...callbacks) => handlers.set(`GET ${route}`, callbacks.at(-1))),
    post: vi.fn((route, ...callbacks) => handlers.set(`POST ${route}`, callbacks.at(-1))),
    patch: vi.fn((route, ...callbacks) => handlers.set(`PATCH ${route}`, callbacks.at(-1))),
    put: vi.fn((route, ...callbacks) => handlers.set(`PUT ${route}`, callbacks.at(-1))),
    delete: vi.fn((route, ...callbacks) => handlers.set(`DELETE ${route}`, callbacks.at(-1))),
  };
  registerTaskboardRoutes(app, { taskboardRuntime });
  return handlers;
};

describe('taskboard routes', () => {
  it('lists a project board through the runtime', async () => {
    const board = { autoRun: false, tasks: [] };
    const list = vi.fn(async () => board);
    const handlers = captureHandlers({ list });
    const res = createResponse();

    await handlers.get('GET /api/projects/:projectId/taskboard')(
      { params: { projectId: 'app' } },
      res,
    );

    expect(list).toHaveBeenCalledWith('app');
    expect(res.payload).toEqual(board);
  });

  it('lists all project boards through the runtime', async () => {
    const aggregate = { schemaVersion: 1, complete: true, projects: [] };
    const listAll = vi.fn(async () => aggregate);
    const handlers = captureHandlers({ listAll });
    const res = createResponse();

    await handlers.get('GET /api/openchamber/taskboard')({}, res);

    expect(listAll).toHaveBeenCalledTimes(1);
    expect(res.payload).toEqual(aggregate);
  });

  it('returns an error when the aggregate runtime cannot read projects', async () => {
    const listAll = vi.fn(async () => {
      const error = new Error('settings offline');
      error.statusCode = 503;
      error.code = 'PROJECT_LIST_FAILED';
      throw error;
    });
    const handlers = captureHandlers({ listAll });
    const res = createResponse();

    await handlers.get('GET /api/openchamber/taskboard')({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: 'settings offline', code: 'PROJECT_LIST_FAILED' });
  });

  it('returns a task version conflict from a move', async () => {
    const move = vi.fn(async () => {
      const error = new Error('stale');
      error.statusCode = 409;
      error.code = 'TASK_VERSION_CONFLICT';
      throw error;
    });
    const handlers = captureHandlers({ moveTask: move });
    const res = createResponse();

    await handlers.get('POST /api/projects/:projectId/taskboard/tasks/:taskId/move')(
      { params: { projectId: 'app', taskId: 'task-1' }, body: { version: 1, status: 'in_progress' } },
      res,
    );

    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ error: 'stale', code: 'TASK_VERSION_CONFLICT' });
  });
});
