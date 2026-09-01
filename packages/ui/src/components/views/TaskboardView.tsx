import * as React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import {
  type TaskboardStatus,
  type TaskboardTask,
  type TaskboardTaskInput,
} from '@/lib/taskboardApi';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useTaskboardStore } from '@/stores/useTaskboardStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { cn } from '@/lib/utils';
import { TaskboardTaskDialog } from '@/components/session/TaskboardTaskDialog';
import { getTaskboardMoveOptions, groupTaskboardTasks, TASKBOARD_COLUMNS } from './taskboardViewModel';

const statusColor = (status: TaskboardStatus): string => {
  if (status === 'done') return 'text-[var(--status-success)]';
  if (status === 'blocked') return 'text-[var(--status-error)]';
  if (status === 'in_progress') return 'text-[var(--status-warning)]';
  if (status === 'in_review') return 'text-[var(--status-info)]';
  return 'text-muted-foreground';
};

const priorityColor = (priority: TaskboardTask['priority']): string => {
  if (priority === 'urgent') return 'text-[var(--status-error)]';
  if (priority === 'high') return 'text-[var(--status-warning)]';
  return 'text-muted-foreground';
};

const formatTaskTime = (value: number, locale: string): string => {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

type TaskCardProps = {
  task: TaskboardTask;
  locale: string;
  onMove: (task: TaskboardTask, status: TaskboardStatus) => Promise<void>;
  onRun: (task: TaskboardTask) => Promise<void>;
  onOpenSession: (task: TaskboardTask) => void;
};

const TaskCard = ({ task, locale, onMove, onRun, onOpenSession }: TaskCardProps) => {
  const { t } = useI18n();
  const [mutating, setMutating] = React.useState(false);
  const hasSession = Boolean(task.sessionId);
  const statusOptions = getTaskboardMoveOptions(task.status);

  const move = async (value: TaskboardStatus) => {
    if (value === task.status) return;
    setMutating(true);
    try {
      await onMove(task, value);
    } finally {
      setMutating(false);
    }
  };

  const run = async () => {
    setMutating(true);
    try {
      await onRun(task);
    } finally {
      setMutating(false);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface-elevated p-3 shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="typography-micro font-semibold text-muted-foreground">{task.identifier}</p>
          <h3 className="mt-1 line-clamp-3 typography-ui-label font-semibold text-foreground">{task.title}</h3>
        </div>
        <Icon name={TASKBOARD_COLUMNS.find((column) => column.status === task.status)?.icon || 'task'} className={cn('size-4 shrink-0', statusColor(task.status))} />
      </div>
      {task.description ? <p className="line-clamp-4 typography-meta text-muted-foreground">{task.description}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full border border-border/60 px-2 py-0.5 typography-micro', priorityColor(task.priority))}>
          {t(`taskboard.priority.${task.priority}`)}
        </span>
        {task.labels.map((label) => (
          <span key={label} className="rounded-full bg-interactive-hover px-2 py-0.5 typography-micro text-muted-foreground">{label}</span>
        ))}
      </div>
      {task.blockedBy.length > 0 ? (
        <p className="typography-micro text-muted-foreground">
          {t('taskboard.card.blockedBy')}
        </p>
      ) : null}
      {task.lastError ? (
        <p className="rounded-lg bg-[var(--status-error-background)] px-2 py-1.5 typography-micro text-[var(--status-error-foreground)]">
          {task.lastError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
        <span className="min-w-0 truncate typography-micro text-muted-foreground">
          {task.runStatus === 'running' ? t('taskboard.card.running') : task.runFinishedAt ? formatTaskTime(task.runFinishedAt, locale) : ''}
        </span>
        <div className="flex items-center gap-1">
          {hasSession ? (
            <Button variant="ghost" size="xs" onClick={() => onOpenSession(task)} disabled={mutating}>
              <Icon name="chat-4" className="size-3.5" />
              {t('taskboard.actions.openSession')}
            </Button>
          ) : null}
          {task.status === 'todo' ? (
            <Button variant="default" size="xs" onClick={() => void run()} disabled={mutating}>
              <Icon name="play" className="size-3.5" />
              {t('taskboard.actions.run')}
            </Button>
          ) : null}
        </div>
      </div>
      <Select<TaskboardStatus> value={task.status} onValueChange={(value) => void move(value)} disabled={mutating}>
        <SelectTrigger size="sm" className="w-full justify-between">
          <SelectValue>{t(`taskboard.status.${task.status}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((status) => (
            <SelectItem
              key={status}
              value={status}
              disabled={status === 'in_progress' || task.runStatus === 'starting' || task.runStatus === 'running'}
            >
              {t(`taskboard.status.${status}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </article>
  );
};

export function TaskboardView() {
  const { t, locale } = useI18n();
  const projects = useProjectsStore((state) => state.projects);
  const activeProject = useProjectsStore((state) => state.getActiveProject());
  const open = useUIStore((state) => state.isTaskboardPageOpen);
  const setOpen = useUIStore((state) => state.setTaskboardPageOpen);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const [selectedProjectId, setSelectedProjectId] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const entry = useTaskboardStore((state) => state.getEntry(selectedProjectId));
  const load = useTaskboardStore((state) => state.load);
  const create = useTaskboardStore((state) => state.create);
  const move = useTaskboardStore((state) => state.move);
  const setAutoRun = useTaskboardStore((state) => state.setAutoRun);
  const runNow = useTaskboardStore((state) => state.runNow);
  const invalidate = useTaskboardStore((state) => state.invalidate);

  React.useEffect(() => {
    if (!open) return;
    const nextProjectId = activeProject?.id || projects[0]?.id || '';
    setSelectedProjectId(nextProjectId);
  }, [activeProject?.id, open, projects]);

  React.useEffect(() => {
    if (!open) setDialogOpen(false);
  }, [open]);

  React.useEffect(() => {
    if (open || !selectedProjectId) return;
    invalidate(selectedProjectId);
  }, [invalidate, open, selectedProjectId]);

  React.useEffect(() => {
    if (!open) return undefined;
    return subscribeOpenchamberEvents((event) => {
      if (event.type === 'taskboard-updated') invalidate(event.projectId);
      if (event.type === 'event-stream-ready' && selectedProjectId) invalidate(selectedProjectId);
    });
  }, [invalidate, open, selectedProjectId]);

  React.useEffect(() => {
    if (!open || !selectedProjectId) return;
    if (entry.loaded) return;
    void load(selectedProjectId, { force: true }).catch(() => {});
  }, [entry.loaded, load, open, selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const board = entry.data;
  const groups = groupTaskboardTasks(board?.tasks || []);

  const handleCreate = async (input: TaskboardTaskInput) => {
    if (!selectedProjectId) return;
    try {
      await create(selectedProjectId, input);
      toast.success(t('taskboard.toast.created'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
      throw error;
    }
  };

  const handleMove = async (task: TaskboardTask, status: TaskboardStatus) => {
    if (!selectedProjectId) return;
    try {
      await move(selectedProjectId, task.id, task.version, status);
      toast.success(t('taskboard.toast.moved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleRun = async (task: TaskboardTask) => {
    if (!selectedProjectId) return;
    try {
      await runNow(selectedProjectId, task.id);
      toast.success(t('taskboard.toast.runStarted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleAutoRun = async () => {
    if (!selectedProjectId || !board) return;
    try {
      await setAutoRun(selectedProjectId, !board.autoRun);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleOpenSession = (task: TaskboardTask) => {
    if (!task.sessionId) return;
    setOpen(false);
    setCurrentSession(task.sessionId, selectedProject?.path || null);
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t('dialog.common.actions.close')} className="mt-0.5 shrink-0">
            <Icon name="arrow-left" className="size-4" />
          </Button>
          <div className="min-w-0">
            <p className="typography-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('taskboard.eyebrow')}</p>
            <h1 className="mt-1 typography-markdown font-semibold text-foreground">{t('taskboard.title')}</h1>
            <p className="mt-1 max-w-2xl typography-meta text-muted-foreground">{t('taskboard.description')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="min-w-44 max-w-64">
              <SelectValue placeholder={t('taskboard.project.placeholder')}>
                {selectedProject?.label || selectedProject?.path || t('taskboard.project.placeholder')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.label || project.path}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => selectedProjectId && void load(selectedProjectId, { force: true })} disabled={!selectedProjectId || entry.loading}>
            <Icon name="refresh" className="size-4" />
            {t('taskboard.actions.refresh')}
          </Button>
          <Button variant="default" size="sm" onClick={() => setDialogOpen(true)} disabled={!selectedProjectId}>
            <Icon name="add" className="size-4" />
            {t('taskboard.actions.new')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2 typography-ui-label">
          <span className={cn('size-2 rounded-full', board?.autoRun ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/50')} />
          <span>{t('taskboard.automation.label')}</span>
          <span className="typography-meta text-muted-foreground">{t('taskboard.automation.description')}</span>
        </div>
        <Button
          variant="chip"
          size="sm"
          aria-pressed={board?.autoRun === true}
          onClick={() => void handleAutoRun()}
          disabled={!board || entry.loading}
        >
          {board?.autoRun ? t('taskboard.automation.enabled') : t('taskboard.automation.disabled')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {entry.loading && !board ? (
          <div className="flex h-full items-center justify-center typography-ui-label text-muted-foreground">{t('taskboard.loading')}</div>
        ) : entry.error && !board ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="typography-ui-label text-[var(--status-error-foreground)]">{entry.error}</p>
            <Button variant="outline" size="sm" onClick={() => void load(selectedProjectId, { force: true })}>{t('taskboard.actions.retry')}</Button>
          </div>
        ) : !board || board.tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="list-check-3" className="size-8 text-muted-foreground/70" />
            <p className="typography-ui-label font-semibold text-foreground">{t('taskboard.empty.title')}</p>
            <p className="max-w-sm typography-meta text-muted-foreground">{t('taskboard.empty.description')}</p>
          </div>
        ) : (
          <div className="grid min-w-[1050px] grid-cols-6 items-start gap-3">
            {TASKBOARD_COLUMNS.map((column) => {
              const items = groups[column.status];
              return (
                <section key={column.status} className="flex min-h-44 flex-col gap-2 rounded-xl bg-surface-muted/50 p-2">
                  <div className="flex items-center justify-between gap-2 px-1 py-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon name={column.icon} className={cn('size-4', statusColor(column.status))} />
                      <h2 className="truncate typography-ui-label font-semibold text-foreground">{t(column.labelKey)}</h2>
                    </div>
                    <span className="typography-micro text-muted-foreground">{items.length}</span>
                  </div>
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      locale={locale}
                      onMove={handleMove}
                      onRun={handleRun}
                      onOpenSession={handleOpenSession}
                    />
                  ))}
                  {items.length === 0 ? <p className="px-1 py-5 text-center typography-micro text-muted-foreground/70">{t('taskboard.empty.column')}</p> : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <TaskboardTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={handleCreate} />
    </div>
  );
}
