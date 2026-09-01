import { randomUUID } from 'node:crypto';

import { getEligibleTasks } from './domain.js';

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_SETTLE_DELAY_MS = 2_500;
const DEFAULT_WORKER_LEASE_MS = 60_000;
const DEFAULT_WORKER_LEASE_RENEW_MS = 20_000;
const DEFAULT_MAX_RUN_DURATION_MS = 30 * 60 * 1000;
const TASK_PROMPT_MAX_LENGTH = 100_000;

const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';

const asString = (value) => isString(value) ? String(value) : '';

const asNonEmptyString = (value) => {
  const normalized = asString(value).trim();
  return normalized || null;
};

const safeErrorMessage = (error) => {
  const message = error instanceof Error ? error.message : asString(error);
  return (message.trim() || 'Task run failed').slice(0, 2_000);
};

const assistantErrorMessage = (error) => {
  if (!isRecord(error)) return 'Assistant turn failed';
  const data = isRecord(error.data) ? error.data : {};
  return asNonEmptyString(error.message)
    || asNonEmptyString(data.message)
    || asNonEmptyString(data.responseBody)
    || 'Assistant turn failed';
};

const extractSessionStatus = (payload) => {
  if (!isRecord(payload) || payload.type !== 'session.status') {
    return null;
  }
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const status = isRecord(properties.status) ? properties.status : {};
  const sessionId = asNonEmptyString(properties.sessionID);
  const type = asNonEmptyString(status.type);
  if (!sessionId || !type) return null;
  return { sessionId, type };
};

const extractAssistantMessage = (payload) => {
  if (!isRecord(payload) || payload.type !== 'message.updated') {
    return null;
  }
  const info = payload.properties?.info;
  if (!isRecord(info) || info.role !== 'assistant') return null;
  const sessionId = asNonEmptyString(info.sessionID);
  if (!sessionId) return null;
  return { sessionId, info };
};

const extractSessionError = (payload) => {
  if (!isRecord(payload) || payload.type !== 'session.error') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const sessionId = asNonEmptyString(properties.sessionID);
  if (!sessionId) return null;
  return { sessionId, error: properties.error };
};

const messageCompleted = (message) => Number.isFinite(message?.info?.time?.completed)
  && message.info.time.completed > 0;

const latestAssistantMessage = (messages) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info?.role === 'assistant') return messages[index];
  }
  return null;
};

const latestUserMessage = (messages) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info?.role === 'user') return messages[index];
  }
  return null;
};

const latestAssistantForUser = (messages, userId) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role === 'assistant' && info.parentID === userId) return messages[index];
  }
  return null;
};

const buildTaskPrompt = (task) => {
  const prompt = [
    `You are executing task ${task.identifier}: ${task.title}`,
    '',
    '<task_description>',
    task.description || '(No additional description.)',
    '</task_description>',
    '',
    `Priority: ${task.priority}`,
    '',
    'Work directly in the current project directory.',
    'Inspect the current state before changing files.',
    'Do not mark the task complete yourself. Run the relevant verification and finish with a concise summary of changes, tests, and remaining risks.',
  ].join('\n');
  return prompt.slice(0, TASK_PROMPT_MAX_LENGTH);
};

export const createTaskboardRuntime = (dependencies) => {
  const {
    taskboardStore,
    listProjects,
    openChamberSessionService,
    fetchSessionMessages,
    fetchSessionStatus = async () => ({ type: 'idle' }),
    emitTaskboardEvent,
    logger = console,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = Date.now,
    createRunId = () => `run_${randomUUID().replaceAll('-', '')}`,
    settleDelayMs = DEFAULT_SETTLE_DELAY_MS,
    workerLeaseMs = DEFAULT_WORKER_LEASE_MS,
    workerLeaseRenewMs = DEFAULT_WORKER_LEASE_RENEW_MS,
    maxRunDurationMs = DEFAULT_MAX_RUN_DURATION_MS,
  } = dependencies;

  if (!taskboardStore || !taskboardStore.list) {
    throw new Error('taskboardStore is required');
  }
  if (!listProjects) {
    throw new Error('listProjects is required');
  }
  if (!openChamberSessionService || !openChamberSessionService.create) {
    throw new Error('openChamberSessionService is required');
  }
  if (!fetchSessionMessages) {
    throw new Error('fetchSessionMessages is required');
  }

  let started = false;
  let stopped = false;
  let pollTimer = null;
  let pumpPromise = null;
  let activeRun = null;
  const runsBySessionId = new Map();
  const workerOwnerId = `worker_${randomUUID().replaceAll('-', '')}`;
  const currentTime = () => {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  };

  const broadcast = (projectId, taskId, kind) => {
    try {
      emitTaskboardEvent?.({ projectId, taskId, kind });
    } catch {
    }
  };

  const clearPollTimer = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const ensureProject = async (projectId) => {
    const projects = await listProjects();
    if (Array.isArray(projects) && projects.some((project) => project?.id === projectId)) return;
    const error = new Error(`Project not found: ${projectId}`);
    error.statusCode = 404;
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  };

  const releaseProjectLease = (projectId) => {
    if (!taskboardStore.releaseWorkerLease) return;
    void taskboardStore.releaseWorkerLease(projectId, workerOwnerId).catch((error) => {
      logger.warn?.('[taskboard] failed to release worker lease', error);
    });
  };

  const acquireProjectLease = async (projectId) => {
    if (!taskboardStore.acquireWorkerLease) return true;
    const result = await taskboardStore.acquireWorkerLease(projectId, workerOwnerId, workerLeaseMs);
    return result.acquired === true;
  };

  const armLeaseRenewal = (run) => {
    if (!taskboardStore.renewWorkerLease) return;
    const interval = Number.isSafeInteger(workerLeaseRenewMs) && workerLeaseRenewMs > 0
      ? workerLeaseRenewMs
      : DEFAULT_WORKER_LEASE_RENEW_MS;
    run.leaseTimer = setInterval(() => {
      void taskboardStore.renewWorkerLease(run.projectId, workerOwnerId, workerLeaseMs)
        .then((result) => {
          if (!result.renewed) logger.warn?.('[taskboard] worker lease renewal was rejected');
        })
        .catch((error) => {
          logger.warn?.('[taskboard] worker lease renewal failed', error);
        });
    }, interval);
    run.leaseTimer.unref?.();
  };

  const releaseRunLease = (run) => {
    if (run?.leaseTimer) clearInterval(run.leaseTimer);
    if (run?.projectId) releaseProjectLease(run.projectId);
  };

  const runTask = async (projectId, taskId, reason) => {
    if (stopped || activeRun) return { skipped: true, reason: activeRun ? 'worker-busy' : 'worker-stopped' };

    await ensureProject(projectId);
    const board = await taskboardStore.list(projectId);
    const task = board.tasks.find((entry) => entry.id === taskId);
    if (!task || task.status !== 'todo') return { skipped: true, reason: 'task-not-eligible' };
    if (reason === 'automatic' && !board.autoRun) return { skipped: true, reason: 'auto-run-disabled' };
    if (!getEligibleTasks(board.tasks).some((entry) => entry.id === taskId)) {
      return { skipped: true, reason: 'task-blocked' };
    }
    if (!await acquireProjectLease(projectId)) {
      return { skipped: true, reason: 'worker-lease-held' };
    }

    const runId = createRunId();
    let claimed;
    try {
      claimed = await taskboardStore.claimNext(projectId, task.id, task.version, runId);
    } catch (error) {
      releaseProjectLease(projectId);
      throw error;
    }
    if (!claimed.claimed) {
      releaseProjectLease(projectId);
      return { skipped: true, reason: 'claim-rejected', task: claimed.task };
    }

    const runState = {
      projectId,
      taskId: task.id,
      runId,
      version: claimed.task.version,
      sessionId: null,
      directory: null,
      settling: false,
      settleTimer: null,
      errorHint: null,
      leaseTimer: null,
      startedAt: currentTime(),
    };
    activeRun = runState;
    armLeaseRenewal(runState);
    broadcast(projectId, task.id, 'claimed');

    let createdSessionId = null;
    try {
      const session = await openChamberSessionService.create({
        projectId,
        title: `${task.identifier}: ${task.title}`,
        prompt: buildTaskPrompt(task),
      });
      const sessionId = asNonEmptyString(session?.sessionId);
      if (!sessionId) throw new Error('OpenCode did not return a session id');
      createdSessionId = sessionId;

      const bound = await taskboardStore.setRunSession(
        projectId,
        task.id,
        runState.version,
        runId,
        sessionId,
      );
      runState.version = bound.task.version;
      runState.sessionId = sessionId;
      runState.directory = asNonEmptyString(session?.directory);
      runsBySessionId.set(sessionId, runState);
      broadcast(projectId, task.id, 'started');
      scheduleSettle(runState);
      if (session.promptDispatched === false) {
        const error = asNonEmptyString(session.promptError) || 'OpenCode did not record the task prompt';
        const finished = await finishRun(runState, { status: 'error', error, sessionId });
        return { ok: false, taskId: task.id, sessionId, error, task: finished.task };
      }
      return { ok: true, taskId: task.id, sessionId, reason };
    } catch (error) {
      const message = safeErrorMessage(error);
      if (stopped) return { ok: false, taskId: task.id, error: message };
      try {
        const outcome = { status: 'error', error: message };
        if (createdSessionId) outcome.sessionId = createdSessionId;
        const finished = await taskboardStore.finishRun(
          projectId,
          task.id,
          runState.version,
          runId,
          outcome,
        );
        broadcast(projectId, task.id, 'blocked');
        return { ok: false, taskId: task.id, error: message, task: finished.task };
      } catch (finishError) {
        logger.warn?.('[taskboard] failed to record task start error', finishError);
        return { ok: false, taskId: task.id, error: message };
      } finally {
        if (activeRun === runState) activeRun = null;
        releaseRunLease(runState);
        wake();
      }
    }
  };

  const pump = async () => {
    if (stopped || activeRun) return null;
    const projects = await listProjects();
    for (const project of Array.isArray(projects) ? projects : []) {
      if (!project?.id) continue;
      let board;
      try {
        board = await taskboardStore.list(project.id);
      } catch (error) {
        logger.warn?.('[taskboard] failed to read project board', project.id, error);
        continue;
      }
      if (!board.autoRun) continue;
      const task = getEligibleTasks(board.tasks)[0];
      if (!task) continue;
      return runTask(project.id, task.id, 'automatic');
    }
    return null;
  };

  const wake = () => {
    if (stopped || !started || pumpPromise) return;
    pumpPromise = Promise.resolve()
      .then(() => pump())
      .catch((error) => {
        logger.warn?.('[taskboard] worker pump failed', error);
        return null;
      })
      .finally(() => {
        pumpPromise = null;
      });
  };

  const clearSettleTimer = (run) => {
    if (!run?.settleTimer) return;
    clearTimeout(run.settleTimer);
    run.settleTimer = null;
  };

  const finishRun = async (run, outcome) => {
    const finished = await taskboardStore.finishRun(run.projectId, run.taskId, run.version, run.runId, outcome);
    run.version = finished.task.version;
    broadcast(run.projectId, run.taskId, outcome.status === 'success' ? 'review' : 'blocked');
    if (activeRun === run) activeRun = null;
    if (run.sessionId) runsBySessionId.delete(run.sessionId);
    releaseRunLease(run);
    wake();
    return finished;
  };

  const scheduleSettle = (run) => {
    if (stopped || !run || activeRun !== run || run.settling || run.settleTimer) return;
    const delay = Number.isFinite(settleDelayMs) && settleDelayMs >= 0 ? settleDelayMs : DEFAULT_SETTLE_DELAY_MS;
    run.settleTimer = setTimeout(() => {
      run.settleTimer = null;
      void settleRun(run);
    }, delay);
    run.settleTimer.unref?.();
  };

  const settleRun = async (run) => {
    if (stopped || !activeRun || activeRun !== run || run.settling || !run.sessionId) return;
    run.settling = true;
    let shouldRetry = false;
    try {
      if (currentTime() - run.startedAt >= maxRunDurationMs) {
        await finishRun(run, { status: 'error', error: 'Task run timed out' });
        return;
      }
      const status = await fetchSessionStatus(run.sessionId, run.directory || run.projectId);
      if (status?.type === 'busy' || status?.type === 'retry') {
        shouldRetry = true;
        return;
      }
      let outcome;
      if (run.errorHint) {
        outcome = { status: 'error', error: run.errorHint };
      } else {
        const messages = await fetchSessionMessages(run.sessionId, run.directory || run.projectId);
        if (!Array.isArray(messages)) {
          shouldRetry = true;
          return;
        }
        const user = latestUserMessage(messages);
        const assistant = user ? latestAssistantForUser(messages, user.info?.id) : null;
        if (!assistant || !messageCompleted(assistant)) {
          shouldRetry = true;
          return;
        }
        outcome = assistant.info.error
          ? { status: 'error', error: assistantErrorMessage(assistant.info.error) }
          : { status: 'success' };
      }
      const latestStatus = await fetchSessionStatus(run.sessionId, run.directory || run.projectId);
      if (latestStatus?.type === 'busy' || latestStatus?.type === 'retry') {
        shouldRetry = true;
        return;
      }
      await finishRun(run, outcome);
    } catch (error) {
      logger.warn?.('[taskboard] failed to settle task run', error);
      shouldRetry = true;
    } finally {
      run.settling = false;
      if (shouldRetry && activeRun === run) scheduleSettle(run);
    }
  };

  const recoverActiveRuns = async () => {
    const projects = await listProjects();
    for (const project of Array.isArray(projects) ? projects : []) {
      if (!project?.id || activeRun) return;
      let board;
      try {
        board = await taskboardStore.list(project.id);
      } catch (error) {
        logger.warn?.('[taskboard] failed to recover project board', project.id, error);
        continue;
      }

      for (const task of board.tasks) {
        if (activeRun) return;
        if (task.status !== 'in_progress') continue;
        if (!task.runId || !task.sessionId) {
          if (!taskboardStore.recoverOrphanedTask) continue;
          if (!await acquireProjectLease(project.id)) continue;
          try {
            const recovered = await taskboardStore.recoverOrphanedTask(
              project.id,
              task.id,
              task.version,
              'Worker stopped before the task session was available',
            );
            if (recovered.recovered) broadcast(project.id, task.id, 'blocked');
          } catch (error) {
            logger.warn?.('[taskboard] failed to recover orphaned task', task.id, error);
          } finally {
            releaseProjectLease(project.id);
          }
          continue;
        }
        if (!await acquireProjectLease(project.id)) continue;
        const run = {
          projectId: project.id,
          taskId: task.id,
          runId: task.runId,
          version: task.version,
          sessionId: task.sessionId,
          directory: project.path || null,
          settling: false,
          settleTimer: null,
          errorHint: null,
          leaseTimer: null,
          startedAt: Number.isFinite(task.runStartedAt) ? task.runStartedAt : currentTime(),
        };
        activeRun = run;
        runsBySessionId.set(run.sessionId, run);
        armLeaseRenewal(run);
        scheduleSettle(run);
      }
    }
  };

  const processPayload = (payload, _directory) => {
    const status = extractSessionStatus(payload);
    if (status) {
      const run = runsBySessionId.get(status.sessionId);
      if (run && (status.type === 'busy' || status.type === 'retry')) clearSettleTimer(run);
      if (run && status.type === 'idle') scheduleSettle(run);
      return;
    }

    const sessionError = extractSessionError(payload);
    if (sessionError) {
      const run = runsBySessionId.get(sessionError.sessionId);
      if (run) {
        run.errorHint = assistantErrorMessage(sessionError.error);
        clearSettleTimer(run);
        scheduleSettle(run);
      }
      return;
    }

    const assistant = extractAssistantMessage(payload);
    if (!assistant) return;
    const run = runsBySessionId.get(assistant.sessionId);
    if (run && assistant.info.error && messageCompleted(assistant)) scheduleSettle(run);
  };

  const start = async () => {
    if (started || stopped) return;
    started = true;
    const interval = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
      ? pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;
    pollTimer = setInterval(wake, interval);
    pollTimer.unref?.();
    await recoverActiveRuns().catch((error) => {
      logger.warn?.('[taskboard] failed to recover active runs', error);
    });
    wake();
  };

  const stop = () => {
    stopped = true;
    started = false;
    clearPollTimer();
    const run = activeRun;
    clearSettleTimer(run);
    activeRun = null;
    releaseRunLease(run);
    runsBySessionId.clear();
  };

  const notifyMutation = (projectId, taskId, kind) => {
    broadcast(projectId, taskId, kind);
    wake();
  };

  const list = async (projectId) => {
    await ensureProject(projectId);
    return taskboardStore.list(projectId);
  };

  const createTask = async (projectId, input) => {
    await ensureProject(projectId);
    const result = await taskboardStore.create(projectId, input);
    notifyMutation(projectId, result.task.id, 'created');
    return result;
  };

  const updateTask = async (projectId, taskId, version, patch) => {
    await ensureProject(projectId);
    const result = await taskboardStore.update(projectId, taskId, version, patch);
    notifyMutation(projectId, taskId, 'updated');
    return result;
  };

  const moveTask = async (projectId, taskId, version, status) => {
    await ensureProject(projectId);
    const result = await taskboardStore.move(projectId, taskId, version, status);
    notifyMutation(projectId, taskId, 'moved');
    return result;
  };

  const removeTask = async (projectId, taskId, version) => {
    await ensureProject(projectId);
    const result = await taskboardStore.remove(projectId, taskId, version);
    notifyMutation(projectId, taskId, 'deleted');
    return result;
  };

  const setAutoRun = async (projectId, enabled) => {
    await ensureProject(projectId);
    const result = await taskboardStore.setAutoRun(projectId, enabled);
    notifyMutation(projectId, null, 'settings');
    return result;
  };

  const runNow = (projectId, taskId) => runTask(projectId, taskId, 'manual');

  const getStatus = () => ({
    running: Boolean(activeRun),
    projectId: activeRun?.projectId || null,
    taskId: activeRun?.taskId || null,
    sessionId: activeRun?.sessionId || null,
  });

  return {
    start,
    stop,
    wake,
    processPayload,
    list,
    createTask,
    updateTask,
    moveTask,
    removeTask,
    runNow,
    setAutoRun,
    getStatus,
  };
};
