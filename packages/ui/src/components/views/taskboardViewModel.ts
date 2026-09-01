import type { IconName } from '@/components/icon/icons';
import type { I18nKey } from '@/lib/i18n';
import type { TaskboardStatus } from '@/lib/taskboardApi';

type TaskboardColumn = {
  status: Exclude<TaskboardStatus, 'canceled'>;
  labelKey: I18nKey;
  icon: IconName;
};

export const TASKBOARD_COLUMNS: readonly TaskboardColumn[] = [
  { status: 'backlog', labelKey: 'taskboard.columns.backlog', icon: 'task' },
  { status: 'todo', labelKey: 'taskboard.columns.todo', icon: 'list-check-3' },
  { status: 'in_progress', labelKey: 'taskboard.columns.inProgress', icon: 'loader-4' },
  { status: 'in_review', labelKey: 'taskboard.columns.inReview', icon: 'search-eye' },
  { status: 'blocked', labelKey: 'taskboard.columns.blocked', icon: 'error-warning' },
  { status: 'done', labelKey: 'taskboard.columns.done', icon: 'checkbox-circle' },
];

type TaskboardTaskWithStatus = { id: string; status: TaskboardStatus };

type TaskboardGroups<T extends TaskboardTaskWithStatus> = {
  [key in TaskboardStatus]: T[];
};

const TASKBOARD_STATUS_OPTIONS = {
  backlog: ['backlog', 'todo'],
  todo: ['todo', 'backlog'],
  in_progress: ['in_progress'],
  in_review: ['in_review', 'todo', 'done'],
  blocked: ['blocked', 'todo'],
  done: ['done', 'todo'],
  canceled: ['canceled', 'todo'],
} satisfies { [key in TaskboardStatus]: TaskboardStatus[] };

export const getTaskboardStatusOptions = (status: TaskboardStatus): TaskboardStatus[] => (
  TASKBOARD_STATUS_OPTIONS[status]
);

export const getTaskboardMoveOptions = (status: TaskboardStatus): TaskboardStatus[] => (
  status === 'in_review'
    ? ['in_review', 'done', 'todo', 'blocked']
    : getTaskboardStatusOptions(status)
);

export const groupTaskboardTasks = <T extends TaskboardTaskWithStatus>(
  tasks: ReadonlyArray<T>,
) => {
  const emptyGroup = (): T[] => [];
  const groups = {
    backlog: emptyGroup(),
    todo: emptyGroup(),
    in_progress: emptyGroup(),
    in_review: emptyGroup(),
    blocked: emptyGroup(),
    done: emptyGroup(),
    canceled: emptyGroup(),
  } satisfies TaskboardGroups<T>;
  for (const task of tasks) groups[task.status].push(task);
  return groups;
};
