import type { IconName } from '@/components/icon/icons';
import type { I18nKey } from '@/lib/i18n';
import type { TaskboardStatus } from '@/lib/taskboardApi';
import type { TaskboardTask } from '@/lib/taskboardApi';

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

export type TaskboardTaskWithProject<T extends TaskboardTaskWithStatus = TaskboardTaskWithStatus> = T & {
  projectId: string;
  projectName: string;
  projectPath: string;
};

type TaskboardProjectTasks<T extends TaskboardTaskWithStatus> = {
  projectId: string;
  name: string;
  path: string;
  state: 'ready' | 'error';
  board: { tasks: ReadonlyArray<T> } | null;
};

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

export const isTaskboardTaskUnstarted = (
  task: Pick<TaskboardTask, 'runStatus' | 'sessionId' | 'runId' | 'history'>,
): boolean => (
  task.runStatus === 'idle'
  && task.sessionId === null
  && task.runId === null
  && !task.history.some((entry) => entry.type === 'claim' || entry.type === 'run')
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

export const flattenTaskboardProjectTasks = <T extends TaskboardTaskWithStatus>(
  projects: ReadonlyArray<TaskboardProjectTasks<T>>,
  selectedProjectId: string,
): Array<TaskboardTaskWithProject<T>> => projects.flatMap((project) => {
  if (project.state !== 'ready' || !project.board || (selectedProjectId !== 'all' && selectedProjectId !== project.projectId)) {
    return [];
  }
  return project.board.tasks.map((task) => ({
    ...task,
    projectId: project.projectId,
    projectName: project.name,
    projectPath: project.path,
  }));
});
