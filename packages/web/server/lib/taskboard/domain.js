export const TASK_STATUSES = Object.freeze([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'canceled',
]);

export const TASK_PRIORITIES = Object.freeze(['none', 'urgent', 'high', 'medium', 'low']);
export const RUN_STATUSES = Object.freeze(['idle', 'starting', 'running', 'success', 'error']);

const MAX_LABELS = 20;
const MAX_HISTORY_LENGTH = 50;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

const STATUS_TRANSITIONS = new Map([
  ['backlog', new Set(['todo', 'canceled'])],
  ['todo', new Set(['in_progress', 'backlog', 'canceled'])],
  ['in_progress', new Set(['in_review', 'blocked', 'todo', 'canceled'])],
  ['in_review', new Set(['done', 'todo', 'blocked'])],
  ['blocked', new Set(['todo', 'canceled'])],
  ['done', new Set(['todo'])],
  ['canceled', new Set(['todo'])],
]);

const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

const asString = (value) => isString(value) ? String(value) : '';

const asNonEmptyString = (value) => {
  const normalized = asString(value).trim();
  return normalized || null;
};

const finiteInteger = (value, fallback) => (
  Number.isFinite(value) && Number.isSafeInteger(Math.round(value))
    ? Math.max(0, Math.round(value))
    : fallback
);

const normalizeLabels = (value) => {
  if (!Array.isArray(value)) return [];
  const labels = [];
  const seen = new Set();
  for (const item of value) {
    const label = asNonEmptyString(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label.slice(0, 64));
    if (labels.length >= MAX_LABELS) break;
  }
  return labels;
};

const normalizeBlockedBy = (value, taskId, identifier) => {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const id = asNonEmptyString(item);
    if (id === taskId || id === identifier) throw new Error('task cannot block itself');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const normalizeNullableString = (value) => asNonEmptyString(value);

const normalizeHistory = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isRecord(entry))
    .slice(-MAX_HISTORY_LENGTH)
    .map((entry) => ({ ...entry }));
};

const normalizeWorkerLease = (value) => {
  if (!isRecord(value)) return null;
  const ownerId = asNonEmptyString(value.ownerId);
  const expiresAt = finiteInteger(value.expiresAt, 0);
  if (!ownerId || expiresAt <= 0) return null;
  return { ownerId, expiresAt };
};

const defaultId = () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const normalizeTask = (value, options = {}) => {
  if (!isRecord(value)) {
    throw new Error('task must be an object');
  }

  const projectId = asNonEmptyString(options.projectId) || asNonEmptyString(value.projectId);
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('task.projectId is invalid');
  }

  const createId = isFunction(options.createId) ? options.createId : defaultId;
  const id = asNonEmptyString(value.id) || createId();
  if (!id) throw new Error('task.id is required');

  const title = asNonEmptyString(value.title);
  if (!title) throw new Error('task.title is required');

  const now = finiteInteger(options.now, Date.now());
  const status = TASK_STATUSES.includes(value.status) ? value.status : 'backlog';
  const priority = TASK_PRIORITIES.includes(value.priority) ? value.priority : 'none';
  const createdAt = finiteInteger(value.createdAt, now);
  const updatedAt = finiteInteger(value.updatedAt, createdAt);
  const runStatus = RUN_STATUSES.includes(value.runStatus) ? value.runStatus : 'idle';

  return {
    id,
    identifier: asNonEmptyString(value.identifier) || id,
    projectId,
    title: title.slice(0, 240),
    description: asString(value.description).trim().slice(0, 100_000),
    status,
    priority,
    labels: normalizeLabels(value.labels),
    blockedBy: normalizeBlockedBy(value.blockedBy, id, asNonEmptyString(value.identifier)),
    sortOrder: Number.isFinite(value.sortOrder) ? value.sortOrder : 0,
    sessionId: normalizeNullableString(value.sessionId),
    runId: normalizeNullableString(value.runId),
    runStatus,
    runStartedAt: Number.isFinite(value.runStartedAt) ? value.runStartedAt : null,
    runFinishedAt: Number.isFinite(value.runFinishedAt) ? value.runFinishedAt : null,
    lastError: normalizeNullableString(value.lastError)?.slice(0, 2_000) || null,
    history: normalizeHistory(value.history),
    version: Math.max(1, finiteInteger(value.version, 1)),
    createdAt,
    updatedAt,
  };
};

export const normalizeTaskboard = (value, options = {}) => {
  const source = isRecord(value) ? value : {};
  const tasks = Array.isArray(source.tasks)
    ? source.tasks.map((task) => {
      try {
        return normalizeTask(task, options);
      } catch {
        return null;
      }
    }).filter(Boolean)
    : [];

  return {
    version: 1,
    nextTaskNumber: Math.max(1, finiteInteger(source.nextTaskNumber, 1)),
    autoRun: source.autoRun === true,
    workerLease: normalizeWorkerLease(source.workerLease),
    tasks,
  };
};

export const canTransitionTaskStatus = (from, to) => {
  if (!TASK_STATUSES.includes(from) || !TASK_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return STATUS_TRANSITIONS.get(from)?.has(to) === true;
};

export const getEligibleTasks = (tasks, taskMap) => {
  const items = Array.isArray(tasks) ? tasks : [];
  const lookup = taskMap || new Map(
    items.flatMap((task) => [
      [task.id, task],
      [task.identifier, task],
    ]),
  );

  return items.filter((task) => (
    task?.status === 'todo'
    && (Array.isArray(task.blockedBy) ? task.blockedBy : [])
      .every((blockedId) => lookup.get(blockedId)?.status === 'done')
  ));
};

export const appendTaskHistory = (task, entry, limit = MAX_HISTORY_LENGTH) => ({
  ...task,
  history: [...normalizeHistory(task?.history), isRecord(entry) ? { ...entry } : {}].slice(-Math.max(1, limit)),
});
