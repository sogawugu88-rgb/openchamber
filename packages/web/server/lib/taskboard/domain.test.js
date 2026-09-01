import { describe, expect, it } from 'vitest';

import {
  RUN_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  appendTaskHistory,
  canTransitionTaskStatus,
  getEligibleTasks,
  normalizeTask,
  normalizeTaskboard,
} from './domain.js';

describe('taskboard domain', () => {
  it('normalizes a task with safe defaults', () => {
    const task = normalizeTask({
      id: 'task-1',
      identifier: 'APP-1',
      projectId: 'app',
      title: '  Ship the board  ',
      description: '  Add the first taskboard slice.  ',
      status: 'todo',
      priority: 'high',
      labels: ['mvp', 'mvp', ''],
      blockedBy: ['APP-0', 'APP-0'],
      createdAt: 10,
      updatedAt: 20,
    }, { projectId: 'app', now: 30 });

    expect(task).toMatchObject({
      id: 'task-1',
      identifier: 'APP-1',
      projectId: 'app',
      title: 'Ship the board',
      description: 'Add the first taskboard slice.',
      status: 'todo',
      priority: 'high',
      labels: ['mvp'],
      blockedBy: ['APP-0'],
      sortOrder: 0,
      sessionId: null,
      runId: null,
      runStatus: 'idle',
      runStartedAt: null,
      runFinishedAt: null,
      lastError: null,
      history: [],
      version: 1,
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it('normalizes a missing board as an empty project board', () => {
    expect(normalizeTaskboard(null, { projectId: 'app', now: 100 })).toEqual({
      version: 1,
      nextTaskNumber: 1,
      autoRun: false,
      workerLease: null,
      tasks: [],
    });
  });

  it('accepts only the task statuses and priorities in the contract', () => {
    expect(TASK_STATUSES).toEqual([
      'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled',
    ]);
    expect(TASK_PRIORITIES).toEqual(['none', 'urgent', 'high', 'medium', 'low']);
    expect(RUN_STATUSES).toEqual(['idle', 'starting', 'running', 'success', 'error']);
  });

  it('rejects invalid status transitions', () => {
    expect(canTransitionTaskStatus('todo', 'in_progress')).toBe(true);
    expect(canTransitionTaskStatus('in_progress', 'in_review')).toBe(true);
    expect(canTransitionTaskStatus('in_review', 'done')).toBe(true);
    expect(canTransitionTaskStatus('backlog', 'in_progress')).toBe(false);
    expect(canTransitionTaskStatus('done', 'in_review')).toBe(false);
  });

  it('selects only todo tasks whose blockers are done', () => {
    const tasks = [
      { id: 'a', status: 'todo', blockedBy: [] },
      { id: 'b', status: 'todo', blockedBy: ['a'] },
      { id: 'c', status: 'in_progress', blockedBy: [] },
      { id: 'd', status: 'todo', blockedBy: ['missing'] },
    ];

    expect(getEligibleTasks(tasks)).toEqual([tasks[0]]);
    expect(getEligibleTasks(tasks, new Map([
      ['a', { id: 'a', status: 'done' }],
      ['missing', { id: 'missing', status: 'done' }],
    ]))).toEqual([tasks[0], tasks[1], tasks[3]]);
  });

  it('keeps only the newest bounded history entries', () => {
    const task = normalizeTask({ id: 'task-1', title: 'Task' }, { projectId: 'app', now: 1 });
    const withHistory = appendTaskHistory(task, { type: 'status', status: 'todo', at: 2 }, 2);
    const next = appendTaskHistory(withHistory, { type: 'status', status: 'in_progress', at: 3 }, 2);
    const final = appendTaskHistory(next, { type: 'status', status: 'blocked', at: 4 }, 2);

    expect(final.history).toEqual([
      { type: 'status', status: 'in_progress', at: 3 },
      { type: 'status', status: 'blocked', at: 4 },
    ]);
  });

  it('rejects a task that blocks itself', () => {
    expect(() => normalizeTask({
      id: 'task-1',
      identifier: 'APP-1',
      title: 'Self dependency',
      blockedBy: ['task-1'],
    }, { projectId: 'app', now: 1 })).toThrow('task cannot block itself');
  });
});
