import { describe, expect, test } from 'bun:test';

import { getTaskboardMoveOptions, getTaskboardStatusOptions, groupTaskboardTasks, TASKBOARD_COLUMNS } from './taskboardViewModel';

describe('taskboard view helpers', () => {
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
});
