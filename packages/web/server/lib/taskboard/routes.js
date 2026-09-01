import express from 'express';

import { TASK_STATUSES } from './domain.js';

const isString = (value) => Object.prototype.toString.call(value) === '[object String]';

const parseProjectId = (req) => isString(req?.params?.projectId) && req.params.projectId.trim()
  ? String(req.params.projectId).trim()
  : null;

const parseTaskId = (req) => isString(req?.params?.taskId) && req.params.taskId.trim()
  ? String(req.params.taskId).trim()
  : null;

const parseVersion = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    const error = new Error('version must be a positive integer');
    error.statusCode = 400;
    error.code = 'INVALID_VERSION';
    throw error;
  }
  return value;
};

const parseStatus = (value) => {
  if (!TASK_STATUSES.includes(value)) {
    const error = new Error(`status must be one of: ${TASK_STATUSES.join(', ')}`);
    error.statusCode = 400;
    error.code = 'INVALID_STATUS';
    throw error;
  }
  return value;
};

const sendError = (res, error, fallback) => {
  const message = error instanceof Error ? error.message : fallback;
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const body = { error: message || fallback };
  if (isString(error?.code)) body.code = String(error.code);
  if (error?.task) body.task = error.task;
  return res.status(statusCode).json(body);
};

const parseBody = express.json({ limit: '1mb' });

export const registerTaskboardRoutes = (app, dependencies) => {
  const { taskboardRuntime } = dependencies;
  if (!taskboardRuntime) throw new Error('taskboardRuntime is required');

  app.get('/api/projects/:projectId/taskboard', async (req, res) => {
    const projectId = parseProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required', code: 'PROJECT_ID_REQUIRED' });
    try {
      return res.json(await taskboardRuntime.list(projectId));
    } catch (error) {
      return sendError(res, error, 'Failed to load taskboard');
    }
  });

  app.put('/api/projects/:projectId/taskboard/settings', parseBody, async (req, res) => {
    const projectId = parseProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required', code: 'PROJECT_ID_REQUIRED' });
    if (req.body?.autoRun !== true && req.body?.autoRun !== false) {
      return res.status(400).json({ error: 'autoRun must be a boolean', code: 'INVALID_AUTORUN' });
    }
    try {
      return res.json(await taskboardRuntime.setAutoRun(projectId, req.body.autoRun));
    } catch (error) {
      return sendError(res, error, 'Failed to update taskboard settings');
    }
  });

  app.post('/api/projects/:projectId/taskboard/tasks', parseBody, async (req, res) => {
    const projectId = parseProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required', code: 'PROJECT_ID_REQUIRED' });
    try {
      return res.status(201).json(await taskboardRuntime.createTask(projectId, req.body || {}));
    } catch (error) {
      return sendError(res, error, 'Failed to create task');
    }
  });

  app.patch('/api/projects/:projectId/taskboard/tasks/:taskId', parseBody, async (req, res) => {
    const projectId = parseProjectId(req);
    const taskId = parseTaskId(req);
    if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId are required', code: 'TASK_ID_REQUIRED' });
    try {
      const version = parseVersion(req.body?.version);
      const { version: _version, ...patch } = req.body || {};
      return res.json(await taskboardRuntime.updateTask(projectId, taskId, version, patch));
    } catch (error) {
      return sendError(res, error, 'Failed to update task');
    }
  });

  app.delete('/api/projects/:projectId/taskboard/tasks/:taskId', parseBody, async (req, res) => {
    const projectId = parseProjectId(req);
    const taskId = parseTaskId(req);
    if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId are required', code: 'TASK_ID_REQUIRED' });
    try {
      return res.json(await taskboardRuntime.removeTask(projectId, taskId, parseVersion(req.body?.version)));
    } catch (error) {
      return sendError(res, error, 'Failed to delete task');
    }
  });

  app.post('/api/projects/:projectId/taskboard/tasks/:taskId/move', parseBody, async (req, res) => {
    const projectId = parseProjectId(req);
    const taskId = parseTaskId(req);
    if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId are required', code: 'TASK_ID_REQUIRED' });
    try {
      return res.json(await taskboardRuntime.moveTask(
        projectId,
        taskId,
        parseVersion(req.body?.version),
        parseStatus(req.body?.status),
      ));
    } catch (error) {
      return sendError(res, error, 'Failed to move task');
    }
  });

  app.post('/api/projects/:projectId/taskboard/tasks/:taskId/run', async (req, res) => {
    const projectId = parseProjectId(req);
    const taskId = parseTaskId(req);
    if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId are required', code: 'TASK_ID_REQUIRED' });
    try {
      const result = await taskboardRuntime.runNow(projectId, taskId);
      return result.skipped && result.reason === 'task-not-eligible'
        ? res.status(409).json(result)
        : res.json(result);
    } catch (error) {
      return sendError(res, error, 'Failed to run task');
    }
  });

  app.get('/api/openchamber/taskboard/status', (_req, res) => res.json(taskboardRuntime.getStatus()));
};
