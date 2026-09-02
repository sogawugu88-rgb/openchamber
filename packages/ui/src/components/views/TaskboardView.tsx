import * as React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import {
  flattenTaskboardProjectTasks,
  getTaskboardMoveOptions,
  groupTaskboardTasks,
  isTaskboardTaskUnstarted,
  TASKBOARD_COLUMNS,
  type TaskboardTaskWithProject,
} from './taskboardViewModel';

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

const isScheduledTask = (task: TaskboardTask): boolean => task.schedule !== null;

const formatTaskSchedule = (task: TaskboardTask): string => {
  if (!task.schedule) return '';
  if (task.schedule.kind === 'daily') return `${task.schedule.times?.join(', ') || task.schedule.time || ''} (${task.schedule.timezone})`;
  return `${task.schedule.date || ''} ${task.schedule.time || ''} (${task.schedule.timezone})`;
};

type TaskCardProps = {
  task: TaskboardTaskWithProject<TaskboardTask>;
  locale: string;
  onMove: (task: TaskboardTaskWithProject<TaskboardTask>, status: TaskboardStatus) => Promise<void>;
  onRun: (task: TaskboardTaskWithProject<TaskboardTask>) => Promise<void>;
  onOpenSession: (task: TaskboardTaskWithProject<TaskboardTask>) => void;
  onEdit: (task: TaskboardTaskWithProject<TaskboardTask>) => void;
  onDelete: (task: TaskboardTaskWithProject<TaskboardTask>) => void;
};

const TaskCard = ({ task, locale, onMove, onRun, onOpenSession, onEdit, onDelete }: TaskCardProps) => {
  const { t } = useI18n();
  const [mutating, setMutating] = React.useState(false);
  const hasSession = Boolean(task.sessionId);
  const statusOptions = getTaskboardMoveOptions(task.status);
  const runStatusLabel = task.runStatus === 'starting' || task.runStatus === 'running'
    ? t('taskboard.card.running')
    : task.runStatus === 'success'
      ? t('taskboard.card.runSucceeded')
        : task.runStatus === 'error'
          ? t('taskboard.card.runFailed')
          : '';
  const scheduleLabel = task.schedule?.kind === 'once' && task.schedule.lastScheduledFor === null
    ? `${t('taskboard.card.scheduled')}: ${formatTaskSchedule(task)}`
    : '';

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
          <p className="typography-micro truncate font-medium text-muted-foreground">{task.projectName}</p>
          <p className="typography-micro font-semibold text-muted-foreground">{task.identifier}</p>
          <h3 className="mt-1 line-clamp-3 typography-ui-label font-semibold text-foreground">{task.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isTaskboardTaskUnstarted(task) ? (
            <>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(task)} disabled={mutating} aria-label={t('taskboard.actions.edit')}>
                <Icon name="edit" className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => onDelete(task)} disabled={mutating} aria-label={t('taskboard.actions.delete')}>
                <Icon name="delete-bin" className="size-3.5" />
              </Button>
            </>
          ) : null}
          <Icon name={TASKBOARD_COLUMNS.find((column) => column.status === task.status)?.icon || 'task'} className={cn('size-4', statusColor(task.status))} />
        </div>
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
          {runStatusLabel || scheduleLabel || (task.runFinishedAt ? formatTaskTime(task.runFinishedAt, locale) : '')}
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
  const open = useUIStore((state) => state.isTaskboardPageOpen);
  const setOpen = useUIStore((state) => state.setTaskboardPageOpen);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const [selectedProjectId, setSelectedProjectId] = React.useState('all');
  const [projectQuery, setProjectQuery] = React.useState('');
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<TaskboardTaskWithProject<TaskboardTask> | null>(null);
  const [deleteTask, setDeleteTask] = React.useState<TaskboardTaskWithProject<TaskboardTask> | null>(null);
  const aggregateEntry = useTaskboardStore((state) => state.getAggregate());
  const entry = useTaskboardStore((state) => state.getEntry(selectedProjectId === 'all' ? null : selectedProjectId));
  const loadAll = useTaskboardStore((state) => state.loadAll);
  const load = useTaskboardStore((state) => state.load);
  const create = useTaskboardStore((state) => state.create);
  const update = useTaskboardStore((state) => state.update);
  const remove = useTaskboardStore((state) => state.remove);
  const move = useTaskboardStore((state) => state.move);
  const setAutoRun = useTaskboardStore((state) => state.setAutoRun);
  const runNow = useTaskboardStore((state) => state.runNow);
  const invalidate = useTaskboardStore((state) => state.invalidate);

  React.useEffect(() => {
    if (!open) return;
    setSelectedProjectId((current) => current === 'all' || projects.some((project) => project.id === current)
      ? current
      : 'all');
    void loadAll().catch(() => {});
  }, [loadAll, open, projects]);

  React.useEffect(() => {
    if (selectedProjectId === 'all') {
      setProjectQuery(t('taskboard.project.all'));
      return;
    }
    const project = projects.find((entry) => entry.id === selectedProjectId);
    setProjectQuery(project?.label || project?.path || t('taskboard.project.placeholder'));
  }, [projects, selectedProjectId, t]);

  React.useEffect(() => {
    if (!open) setDialogOpen(false);
  }, [open]);

  React.useEffect(() => {
    if (open || selectedProjectId === 'all') return;
    invalidate(selectedProjectId);
  }, [invalidate, open, selectedProjectId]);

  React.useEffect(() => {
    if (!open) return undefined;
    return subscribeOpenchamberEvents((event) => {
      if (event.type === 'taskboard-updated') {
        invalidate(event.projectId);
        void load(event.projectId, { force: true }).catch(() => {});
      }
      if (event.type === 'event-stream-ready') void loadAll({ force: true }).catch(() => {});
    });
  }, [invalidate, load, loadAll, open]);

  React.useEffect(() => {
    if (!open || selectedProjectId === 'all') return;
    if (entry.loaded) return;
    void load(selectedProjectId, { force: true }).catch(() => {});
  }, [entry.loaded, load, open, selectedProjectId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const filteredProjects = projects.filter((project) => {
    const query = projectQuery.trim().toLowerCase();
    if (!query || query === t('taskboard.project.all').toLowerCase()) return true;
    return `${project.label || ''} ${project.path}`.toLowerCase().includes(query);
  });
  const aggregate = aggregateEntry.data;
  const selectedProjectBoard = selectedProjectId === 'all'
    ? null
    : aggregate?.projects.find((project) => project.projectId === selectedProjectId)?.board || entry.data;
  const visibleTasks = flattenTaskboardProjectTasks<TaskboardTask>(aggregate?.projects || [], selectedProjectId);
  const scheduledTasks = visibleTasks.filter((task) => task.schedule?.kind === 'daily');
  const workflowTasks = visibleTasks.filter((task) => !isScheduledTask(task) || task.schedule?.kind === 'once');
  const groups = groupTaskboardTasks(workflowTasks);

  const handleCreate = async (projectId: string, input: TaskboardTaskInput) => {
    try {
      if (editingTask) {
        await update(projectId, editingTask.id, editingTask.version, {
          title: input.title,
          description: input.description,
          labels: input.labels,
          priority: input.priority,
          execution: input.execution,
          schedule: input.schedule || null,
        });
        toast.success(t('taskboard.toast.updated'));
      } else {
        await create(projectId, input);
        toast.success(t('taskboard.toast.created'));
      }
      setEditingTask(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!deleteTask) return;
    try {
      await remove(deleteTask.projectId, deleteTask.id, deleteTask.version);
      setDeleteTask(null);
      toast.success(t('taskboard.toast.deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleMove = async (task: TaskboardTaskWithProject<TaskboardTask>, status: TaskboardStatus) => {
    try {
      await move(task.projectId, task.id, task.version, status);
      toast.success(t('taskboard.toast.moved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleRun = async (task: TaskboardTaskWithProject<TaskboardTask>) => {
    try {
      await runNow(task.projectId, task.id);
      toast.success(t('taskboard.toast.runStarted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleAutoRun = async () => {
    if (!selectedProjectId || selectedProjectId === 'all' || !selectedProjectBoard) return;
    try {
      await setAutoRun(selectedProjectId, !selectedProjectBoard.autoRun);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('taskboard.toast.failed'));
    }
  };

  const handleOpenSession = (task: TaskboardTaskWithProject<TaskboardTask>) => {
    if (!task.sessionId) return;
    setOpen(false);
    setCurrentSession(task.sessionId, task.projectPath || selectedProject?.path || null);
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
          <div className="relative min-w-44 max-w-64">
            <Input
              value={projectQuery}
              onChange={(event) => {
                setProjectQuery(event.target.value);
                setProjectPickerOpen(true);
              }}
              onFocus={() => setProjectPickerOpen(true)}
              placeholder={t('taskboard.project.placeholder')}
              role="combobox"
              aria-label={t('taskboard.dialog.fields.project')}
              aria-expanded={projectPickerOpen}
            />
            {projectPickerOpen ? (
              <div className="absolute right-0 z-20 mt-1 max-h-56 w-72 overflow-y-auto rounded-lg border border-border bg-surface-elevated p-1 shadow-lg">
                <button
                  type="button"
                  className={cn('w-full rounded-md px-2 py-1.5 text-left typography-ui-label hover:bg-interactive-hover', selectedProjectId === 'all' && 'bg-interactive-hover')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { setSelectedProjectId('all'); setProjectPickerOpen(false); }}
                >
                  {t('taskboard.project.all')}
                </button>
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={cn('flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-interactive-hover', project.id === selectedProjectId && 'bg-interactive-hover')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setSelectedProjectId(project.id); setProjectPickerOpen(false); }}
                  >
                    <span className="typography-ui-label text-foreground">{project.label || project.path}</span>
                    {project.label ? <span className="truncate typography-micro text-muted-foreground">{project.path}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadAll({ force: true })} disabled={aggregateEntry.loading}>
            <Icon name="refresh" className="size-4" />
            {t('taskboard.actions.refresh')}
          </Button>
          <Button variant="default" size="sm" onClick={() => { setEditingTask(null); setDialogOpen(true); }} disabled={projects.length === 0}>
            <Icon name="add" className="size-4" />
            {t('taskboard.actions.new')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2 typography-ui-label">
          <span className={cn('size-2 rounded-full', selectedProjectBoard?.autoRun ? 'bg-[var(--status-success)]' : 'bg-muted-foreground/50')} />
          <span>{t('taskboard.automation.label')}</span>
          <span className="typography-meta text-muted-foreground">{t('taskboard.automation.description')}</span>
        </div>
        {selectedProjectId === 'all' ? (
          <span className="typography-micro text-muted-foreground">{t('taskboard.project.all')}</span>
        ) : (
          <Button
            variant="chip"
            size="sm"
            aria-pressed={selectedProjectBoard?.autoRun === true}
            onClick={() => void handleAutoRun()}
            disabled={!selectedProjectBoard || entry.loading}
          >
            {selectedProjectBoard?.autoRun ? t('taskboard.automation.enabled') : t('taskboard.automation.disabled')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {aggregateEntry.loading && !aggregate ? (
          <div className="flex h-full items-center justify-center typography-ui-label text-muted-foreground">{t('taskboard.loading')}</div>
        ) : aggregateEntry.error && !aggregate ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="typography-ui-label text-[var(--status-error-foreground)]">{aggregateEntry.error}</p>
            <Button variant="outline" size="sm" onClick={() => void loadAll({ force: true })}>{t('taskboard.actions.retry')}</Button>
          </div>
        ) : aggregate && !aggregate.complete ? (
          <div className="mb-3 rounded-lg border border-[var(--status-warning)]/40 bg-[var(--status-warning-background)] px-3 py-2 typography-micro text-[var(--status-warning-foreground)]">
            {t('taskboard.aggregate.partial')}
          </div>
        ) : null}
        {aggregate && scheduledTasks.length > 0 ? (
          <section className="mb-4 rounded-xl border border-border/70 bg-surface-elevated p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="typography-ui-label font-semibold text-foreground">{t('taskboard.schedule.title')}</h2>
                <p className="typography-micro text-muted-foreground">{t('taskboard.schedule.description')}</p>
              </div>
              <span className="typography-micro text-muted-foreground">{scheduledTasks.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {scheduledTasks.map((task) => (
                <article key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-surface-muted/30 p-3">
                  <div className="min-w-0">
                    <p className="typography-micro font-semibold text-muted-foreground">{task.projectName} · {task.identifier}</p>
                    <h3 className="mt-1 truncate typography-ui-label font-semibold text-foreground">{task.title}</h3>
                    <p className="mt-1 typography-micro text-muted-foreground">
                      {task.schedule?.kind === 'daily'
                        ? `${t('taskboard.schedule.daily')}: ${formatTaskSchedule(task)}`
                        : `${t('taskboard.schedule.once')}: ${formatTaskSchedule(task)}`}
                    </p>
                  </div>
                  {isTaskboardTaskUnstarted(task) ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => { setEditingTask(task); setDialogOpen(true); }} aria-label={t('taskboard.actions.edit')}>
                        <Icon name="edit" className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => setDeleteTask(task)} aria-label={t('taskboard.actions.delete')}>
                        <Icon name="delete-bin" className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {aggregate && workflowTasks.length === 0 && scheduledTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Icon name="list-check-3" className="size-8 text-muted-foreground/70" />
            <p className="typography-ui-label font-semibold text-foreground">{t('taskboard.empty.title')}</p>
            <p className="max-w-sm typography-meta text-muted-foreground">{t('taskboard.empty.description')}</p>
          </div>
        ) : aggregate && workflowTasks.length > 0 ? (
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
                       onEdit={(task) => { setEditingTask(task); setDialogOpen(true); }}
                       onDelete={setDeleteTask}
                    />
                  ))}
                  {items.length === 0 ? <p className="px-1 py-5 text-center typography-micro text-muted-foreground/70">{t('taskboard.empty.column')}</p> : null}
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
       <TaskboardTaskDialog
         open={dialogOpen}
         projects={projects}
         initialProjectId={editingTask?.projectId || (selectedProjectId === 'all' ? null : selectedProjectId)}
         task={editingTask}
         onOpenChange={(nextOpen) => { setDialogOpen(nextOpen); if (!nextOpen) setEditingTask(null); }}
         onSubmit={handleCreate}
       />
       <Dialog open={Boolean(deleteTask)} onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteTask(null); }}>
         <DialogContent className="max-w-sm">
           <DialogHeader>
             <DialogTitle>{t('taskboard.delete.title')}</DialogTitle>
             <DialogDescription>{t('taskboard.delete.description')}</DialogDescription>
           </DialogHeader>
           <DialogFooter>
             <Button variant="ghost" onClick={() => setDeleteTask(null)}>{t('taskboard.delete.cancel')}</Button>
             <Button variant="destructive" onClick={() => void handleDelete()}>{t('taskboard.delete.confirm')}</Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
    </div>
  );
}
