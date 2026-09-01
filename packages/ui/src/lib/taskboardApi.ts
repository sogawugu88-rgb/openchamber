import { runtimeFetch } from './runtime-fetch';

import { z } from 'zod';

const taskboardStatusSchema = z.enum([
  'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled',
]);
const taskboardPrioritySchema = z.enum(['none', 'urgent', 'high', 'medium', 'low']);
const taskboardRunStatusSchema = z.enum(['idle', 'starting', 'running', 'success', 'error']);
const taskboardHistorySchema = z.object({
  type: z.enum(['update', 'status', 'claim', 'run']),
  at: z.number(),
  fields: z.array(z.string()).optional(),
  from: taskboardStatusSchema.optional(),
  status: z.union([taskboardStatusSchema, taskboardRunStatusSchema]).optional(),
  runId: z.string().optional(),
  error: z.string().nullable().optional(),
});
const taskboardTaskSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  status: taskboardStatusSchema,
  priority: taskboardPrioritySchema,
  labels: z.array(z.string()),
  blockedBy: z.array(z.string()),
  sortOrder: z.number(),
  sessionId: z.string().nullable(),
  runId: z.string().nullable(),
  runStatus: taskboardRunStatusSchema,
  runStartedAt: z.number().nullable(),
  runFinishedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  history: z.array(taskboardHistorySchema),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
const taskboardSchema = z.object({
  version: z.number(),
  nextTaskNumber: z.number(),
  autoRun: z.boolean(),
  tasks: z.array(taskboardTaskSchema),
});
const taskboardMutationSchema = z.object({ task: taskboardTaskSchema, board: taskboardSchema });
const taskboardDeleteSchema = z.object({
  deleted: z.boolean(),
  task: taskboardTaskSchema,
  board: taskboardSchema,
});
const taskboardRunResultSchema = z.object({
  ok: z.boolean().optional(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
});
const taskboardErrorSchema = z.object({ error: z.string().optional(), code: z.string().optional() });

export type TaskboardStatus = z.infer<typeof taskboardStatusSchema>;
export type TaskboardPriority = z.infer<typeof taskboardPrioritySchema>;

export type TaskboardTask = z.infer<typeof taskboardTaskSchema>;
export type Taskboard = z.infer<typeof taskboardSchema>;

export type TaskboardTaskInput = {
  title: string;
  description?: string;
  status?: TaskboardStatus;
  priority?: TaskboardPriority;
  labels?: string[];
  blockedBy?: string[];
};

export type TaskboardTaskPatch = Partial<Pick<
  TaskboardTask,
  'title' | 'description' | 'priority' | 'labels' | 'blockedBy'
>>;

type TaskboardMutation = {
  task: TaskboardTask;
  board: Taskboard;
};

type TaskboardDeleteResult = {
  deleted: boolean;
  task: TaskboardTask;
  board: Taskboard;
};

type TaskboardRunResult = z.infer<typeof taskboardRunResultSchema>;

export class TaskboardApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'TaskboardApiError';
    this.status = status;
    this.code = code;
  }
}

const ensureProjectId = (projectId: string): string => {
  const normalized = projectId.trim();
  if (!normalized) throw new Error('projectId is required');
  return normalized;
};

const ensureTaskId = (taskId: string): string => {
  const normalized = taskId.trim();
  if (!normalized) throw new Error('taskId is required');
  return normalized;
};

const parseApiError = async (response: Response, fallback: string): Promise<TaskboardApiError> => {
  try {
    const parsed = taskboardErrorSchema.safeParse(await response.json());
    if (parsed.success) {
      return new TaskboardApiError(
        parsed.data.error?.trim() || fallback,
        response.status,
        parsed.data.code || null,
      );
    }
  } catch {
    return new TaskboardApiError(fallback, response.status, null);
  }
  return new TaskboardApiError(fallback, response.status, null);
};

const taskboardPath = (projectId: string): string => (
  `/api/projects/${encodeURIComponent(ensureProjectId(projectId))}/taskboard`
);

const taskPath = (projectId: string, taskId: string): string => (
  `${taskboardPath(projectId)}/tasks/${encodeURIComponent(ensureTaskId(taskId))}`
);

export const fetchTaskboard = async (projectId: string): Promise<Taskboard> => {
  const response = await runtimeFetch(taskboardPath(projectId));
  if (!response.ok) throw await parseApiError(response, 'Failed to load taskboard');
  return taskboardSchema.parse(await response.json());
};

export const setTaskboardAutoRun = async (projectId: string, autoRun: boolean): Promise<Taskboard> => {
  const response = await runtimeFetch(`${taskboardPath(projectId)}/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ autoRun }),
  });
  if (!response.ok) throw await parseApiError(response, 'Failed to update taskboard settings');
  const parsed = z.object({ board: taskboardSchema }).parse(await response.json());
  return parsed.board;
};

export const createTaskboardTask = async (
  projectId: string,
  input: TaskboardTaskInput,
): Promise<TaskboardMutation> => {
  const response = await runtimeFetch(`${taskboardPath(projectId)}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseApiError(response, 'Failed to create task');
  return taskboardMutationSchema.parse(await response.json());
};

export const updateTaskboardTask = async (
  projectId: string,
  taskId: string,
  version: number,
  patch: TaskboardTaskPatch,
): Promise<TaskboardMutation> => {
  const response = await runtimeFetch(taskPath(projectId, taskId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ version, ...patch }),
  });
  if (!response.ok) throw await parseApiError(response, 'Failed to update task');
  return taskboardMutationSchema.parse(await response.json());
};

export const moveTaskboardTask = async (
  projectId: string,
  taskId: string,
  version: number,
  status: TaskboardStatus,
): Promise<TaskboardMutation> => {
  const response = await runtimeFetch(`${taskPath(projectId, taskId)}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ version, status }),
  });
  if (!response.ok) throw await parseApiError(response, 'Failed to move task');
  return taskboardMutationSchema.parse(await response.json());
};

export const deleteTaskboardTask = async (
  projectId: string,
  taskId: string,
  version: number,
): Promise<TaskboardDeleteResult> => {
  const response = await runtimeFetch(taskPath(projectId, taskId), {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!response.ok) throw await parseApiError(response, 'Failed to delete task');
  return taskboardDeleteSchema.parse(await response.json());
};

export const runTaskboardTask = async (projectId: string, taskId: string): Promise<TaskboardRunResult> => {
  const response = await runtimeFetch(`${taskPath(projectId, taskId)}/run`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorResponse = taskboardErrorSchema.safeParse(parsed);
    const message = errorResponse.success && errorResponse.data.error
      ? errorResponse.data.error
      : 'Failed to run task';
    const code = errorResponse.success ? errorResponse.data.code || null : null;
    throw new TaskboardApiError(message, response.status, code);
  }
  return taskboardRunResultSchema.parse(parsed);
};
