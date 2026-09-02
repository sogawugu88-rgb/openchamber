import { describe, expect, test } from 'bun:test';
import type { TaskboardStatus } from '@/lib/taskboardApi';

import {
  flattenTaskboardProjectTasks,
  getTaskboardMoveOptions,
  getTaskboardStatusOptions,
  groupTaskboardTasks,
  isTaskboardTaskUnstarted,
  TASKBOARD_COLUMNS,
} from './taskboardViewModel';

describe('taskboard view helpers', () => {
  type ViewTask = { id: string; status: TaskboardStatus };

  test('groups tasks by workflow status without dropping empty columns', () => {
    const groups = groupTaskboardTasks([
      { id: 'a', status: 'todo' },
      { id: 'b', status: 'done' },
      { id: 'c', status: 'todo' },
    ]);

    expect(TASKBOARD_COLUMNS.map((column) => column.status)).toEqual([
      'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done',
    ]);
    expect(groups.backlog).toEqual([]);
    expect(groups.todo.map((task) => task.id)).toEqual(['a', 'c']);
    expect(groups.done.map((task) => task.id)).toEqual(['b']);
  });

  test('exposes only valid user status moves', () => {
    expect(getTaskboardStatusOptions('todo')).toEqual(['todo', 'backlog']);
    expect(getTaskboardStatusOptions('in_review')).toEqual(['in_review', 'todo', 'done']);
    expect(getTaskboardStatusOptions('in_progress')).toEqual(['in_progress']);
  });

  test('offers only user-valid status moves', () => {
    expect(getTaskboardMoveOptions('backlog')).toEqual(['backlog', 'todo']);
    expect(getTaskboardMoveOptions('todo')).toEqual(['todo', 'backlog']);
    expect(getTaskboardMoveOptions('in_review')).toEqual(['in_review', 'done', 'todo', 'blocked']);
    expect(getTaskboardMoveOptions('in_progress')).toEqual(['in_progress']);
  });

  test('flattens ready project boards and filters by project without including failed boards', () => {
    const projects = [
      { projectId: 'app', name: 'App', path: '/repo', state: 'ready' as const, board: { tasks: [{ id: 'a', status: 'todo' as const }] }, error: null },
      { projectId: 'broken', name: 'Broken', path: '/broken', state: 'error' as const, board: null, error: { code: 'TASKBOARD_READ_FAILED', message: 'offline' } },
      { projectId: 'other', name: 'Other', path: '/other', state: 'ready' as const, board: { tasks: [{ id: 'b', status: 'done' as const }] }, error: null },
    ];

    expect(flattenTaskboardProjectTasks<ViewTask>(projects, 'all')).toEqual([
      { id: 'a', status: 'todo', projectId: 'app', projectName: 'App', projectPath: '/repo' },
      { id: 'b', status: 'done', projectId: 'other', projectName: 'Other', projectPath: '/other' },
    ]);
    expect(flattenTaskboardProjectTasks<ViewTask>(projects, 'other')).toEqual([
      { id: 'b', status: 'done', projectId: 'other', projectName: 'Other', projectPath: '/other' },
    ]);
  });

  test('only marks tasks with no run history as editable', () => {
    expect(isTaskboardTaskUnstarted({ runStatus: 'idle', sessionId: null, runId: null, history: [] })).toBe(true);
    expect(isTaskboardTaskUnstarted({ runStatus: 'running', sessionId: null, runId: 'run-1', history: [] })).toBe(false);
    expect(isTaskboardTaskUnstarted({ runStatus: 'error', sessionId: null, runId: 'run-1', history: [{ type: 'run', at: 1 }] })).toBe(false);
    expect(isTaskboardTaskUnstarted({ runStatus: 'idle', sessionId: null, runId: null, history: [{ type: 'claim', at: 1 }] })).toBe(false);
  });
});
