import * as React from 'react';

import type { ProjectEntry } from '@/lib/api/types';
import type { Session } from '@opencode-ai/sdk/v2';
import { AgentSelector } from '@/components/sections/commands/AgentSelector';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { ThinkingPill } from '@/components/session/ThinkingPill';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import type { TaskboardPriority, TaskboardStatus, TaskboardTask, TaskboardTaskInput } from '@/lib/taskboardApi';
import { cn } from '@/lib/utils';
import { selectAgentsForDirectory, useAgentsStore } from '@/stores/useAgentsStore';
import { selectProvidersForDirectory, useConfigStore } from '@/stores/useConfigStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';

type TaskboardTaskDialogProps = {
  open: boolean;
  projects: ProjectEntry[];
  initialProjectId?: string | null;
  task?: TaskboardTask | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (projectId: string, input: TaskboardTaskInput) => Promise<void>;
};

const priorities: TaskboardPriority[] = ['none', 'urgent', 'high', 'medium', 'low'];
const statuses: TaskboardStatus[] = ['backlog', 'todo'];
const scheduleKinds = ['none', 'once', 'daily'] as const;
type TaskboardScheduleKind = (typeof scheduleKinds)[number];
const contextModes = ['new', 'fork', 'handoff'] as const;
type TaskboardContextMode = (typeof contextModes)[number];
const EMPTY_SOURCE_SESSIONS: Session[] = [];

const localDateValue = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};

const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const resolveDefaultModel = (
  project: ProjectEntry | null,
  providers: ReturnType<typeof selectProvidersForDirectory>,
) => {
  const configured = project?.defaultModel?.trim().split('/') || [];
  if (configured.length === 2) {
    const provider = providers.find((entry) => entry.id === configured[0]);
    if (provider?.models?.some((model) => model.id === configured[1])) {
      return { providerId: configured[0], modelId: configured[1], variant: project?.defaultVariant || '' };
    }
  }
  for (const provider of providers) {
    const model = provider.models?.[0];
    if (provider.id && model?.id) return { providerId: provider.id, modelId: model.id, variant: '' };
  }
  return { providerId: '', modelId: '', variant: '' };
};

const resolveDefaultAgent = (agents: ReturnType<typeof selectAgentsForDirectory>): string => (
  agents.find((agent) => agent.name === 'build' && (agent.mode === 'primary' || agent.mode === 'all'))?.name
  || agents.find((agent) => agent.mode === 'primary' || agent.mode === 'all')?.name
  || ''
);

const sessionLabel = (session: Session): string => session.title?.trim() || session.id;

export function TaskboardTaskDialog({
  open,
  projects,
  initialProjectId,
  task = null,
  onOpenChange,
  onSubmit,
}: TaskboardTaskDialogProps) {
  const { t } = useI18n();
  const [selectedProjectId, setSelectedProjectId] = React.useState('');
  const [projectQuery, setProjectQuery] = React.useState('');
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const [providerId, setProviderId] = React.useState('');
  const [modelId, setModelId] = React.useState('');
  const [variant, setVariant] = React.useState('');
  const [agentName, setAgentName] = React.useState('');
  const [permissionAutoAccept, setPermissionAutoAccept] = React.useState(false);
  const [goalEnabled, setGoalEnabled] = React.useState(false);
  const [goalObjective, setGoalObjective] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [labels, setLabels] = React.useState('');
  const [priority, setPriority] = React.useState<TaskboardPriority>('none');
  const [status, setStatus] = React.useState<TaskboardStatus>('backlog');
  const [scheduleKind, setScheduleKind] = React.useState<TaskboardScheduleKind>('none');
  const [scheduleDate, setScheduleDate] = React.useState(localDateValue);
  const [scheduleTime, setScheduleTime] = React.useState('09:00');
  const [scheduleTimezone, setScheduleTimezone] = React.useState(localTimezone);
  const [contextMode, setContextMode] = React.useState<TaskboardContextMode>('new');
  const [sourceSessionId, setSourceSessionId] = React.useState('');
  const [sourceSessionQuery, setSourceSessionQuery] = React.useState('');
  const [sourceSessionPickerOpen, setSourceSessionPickerOpen] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const isEditing = Boolean(task);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const directory = selectedProject?.path || null;
  const providers = useConfigStore((state) => selectProvidersForDirectory(state, directory));
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const agents = useAgentsStore((state) => selectAgentsForDirectory(state, directory));
  const loadAgents = useAgentsStore((state) => state.loadAgents);
  const sourceSessions = useGlobalSessionsStore((state) => (directory ? state.sessionsByDirectory.get(directory) || EMPTY_SOURCE_SESSIONS : EMPTY_SOURCE_SESSIONS));

  React.useEffect(() => {
    if (!open) return;
    const preferredProjectId = task?.projectId || initialProjectId;
    const nextProjectId = preferredProjectId && projects.some((project) => project.id === preferredProjectId)
      ? preferredProjectId
      : projects[0]?.id || '';
    const project = projects.find((entry) => entry.id === nextProjectId);
    setSelectedProjectId(nextProjectId);
    setProjectQuery(project?.label || project?.path || '');
    setProjectPickerOpen(false);
    setProviderId(task?.execution?.providerID || '');
    setModelId(task?.execution?.modelID || '');
    setVariant(task?.execution?.variant || '');
    setAgentName(task?.execution?.agent || '');
    setPermissionAutoAccept(task?.execution?.permissionAutoAccept === true);
    setGoalEnabled(Boolean(task?.execution?.goal));
    setGoalObjective(task?.execution?.goal?.objective || '');
    setTitle(task?.title || '');
    setDescription(task?.description || '');
    setLabels(task?.labels.join(', ') || '');
    setPriority(task?.priority || 'none');
    setStatus(task?.status === 'todo' ? 'todo' : 'backlog');
    setScheduleKind(task?.schedule?.kind || 'none');
    setScheduleDate(task?.schedule?.kind === 'once' ? task.schedule.date || localDateValue() : localDateValue());
    setScheduleTime(task?.schedule?.kind === 'once' ? task.schedule.time || '09:00' : task?.schedule?.times?.[0] || '09:00');
    setScheduleTimezone(task?.schedule?.timezone || localTimezone());
    const target = task?.execution?.sessionTarget;
    setContextMode(target?.mode === 'fork' || target?.mode === 'handoff' ? target.mode : 'new');
    setSourceSessionId(target && target.mode !== 'new' ? target.sourceSessionId : '');
    setSourceSessionQuery('');
    setSourceSessionPickerOpen(false);
    setValidationError(null);
    setSaving(false);
  }, [initialProjectId, open, projects, task]);

  React.useEffect(() => {
    const selected = sourceSessions.find((session) => session.id === sourceSessionId);
    if (selected) setSourceSessionQuery(sessionLabel(selected));
  }, [sourceSessionId, sourceSessions]);

  React.useEffect(() => {
    if (!open || !directory) return;
    void loadProviders({ directory, source: 'taskboardDialog' });
    void loadAgents(directory);
  }, [directory, loadAgents, loadProviders, open]);

  React.useEffect(() => {
    if (!open || !selectedProject) return;
    const defaultModel = resolveDefaultModel(selectedProject, providers);
    setProviderId((current) => current || defaultModel.providerId);
    setModelId((current) => current || defaultModel.modelId);
    setVariant((current) => current || defaultModel.variant);
    setAgentName((current) => current || resolveDefaultAgent(agents));
  }, [agents, open, providers, selectedProject]);

  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const selectedModel = selectedProvider?.models?.find((model) => model.id === modelId);
  const variantOptions = Object.keys(selectedModel?.variants || {});
  const filteredProjects = projects.filter((project) => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return true;
    return `${project.label || ''} ${project.path}`.toLowerCase().includes(query);
  });
  const filteredSourceSessions = sourceSessions.filter((session) => {
    const query = sourceSessionQuery.trim().toLowerCase();
    if (!query) return true;
    return `${session.title || ''} ${session.id}`.toLowerCase().includes(query);
  });

  React.useEffect(() => {
    if (!selectedModel || !variant) return;
    if (!Object.prototype.hasOwnProperty.call(selectedModel.variants || {}, variant)) setVariant('');
  }, [selectedModel, variant]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const normalizedTitle = title.trim();
    const normalizedObjective = goalObjective.trim();
    if (!selectedProjectId) {
      setValidationError(t('taskboard.dialog.validation.projectRequired'));
      return;
    }
    if (!providerId || !modelId) {
      setValidationError(t('taskboard.dialog.validation.modelRequired'));
      return;
    }
    if (!agentName) {
      setValidationError(t('taskboard.dialog.validation.agentRequired'));
      return;
    }
    if (contextMode !== 'new' && !sourceSessionId) {
      setValidationError(t('taskboard.dialog.validation.sourceSessionRequired'));
      return;
    }
    if (goalEnabled && !normalizedObjective) {
      setValidationError(t('taskboard.dialog.validation.goalObjectiveRequired'));
      return;
    }
    if (!normalizedTitle) return;

    setValidationError(null);
    setSaving(true);
    try {
      await onSubmit(selectedProjectId, {
        title: normalizedTitle,
        description: description.trim(),
        labels: labels.split(',').map((label) => label.trim()).filter(Boolean),
        priority,
        status,
        execution: {
          providerID: providerId,
          modelID: modelId,
          variant: variant || null,
          agent: agentName,
          permissionAutoAccept,
          goal: goalEnabled ? { objective: normalizedObjective } : null,
          sessionTarget: contextMode === 'new'
            ? { mode: 'new' }
            : { mode: contextMode, sourceSessionId },
        },
        schedule: scheduleKind === 'none'
          ? undefined
          : scheduleKind === 'once'
            ? { kind: 'once', date: scheduleDate, time: scheduleTime, timezone: scheduleTimezone }
            : { kind: 'daily', time: scheduleTime, timezone: scheduleTimezone },
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleProjectChange = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    setSelectedProjectId(projectId);
    setProjectQuery(project?.label || project?.path || '');
    setProjectPickerOpen(false);
    setProviderId('');
    setModelId('');
    setVariant('');
    setAgentName('');
    setSourceSessionId('');
    setSourceSessionQuery('');
    setValidationError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92vh,52rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(isEditing ? 'taskboard.dialog.editTitle' : 'taskboard.dialog.title')}</DialogTitle>
          <DialogDescription>{t('taskboard.dialog.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.project')}</span>
            <div className="relative">
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
                disabled={isEditing}
              />
              {projectPickerOpen && !isEditing ? (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface-elevated p-1 shadow-lg">
                  {filteredProjects.length > 0 ? filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={cn('flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-interactive-hover', project.id === selectedProjectId && 'bg-interactive-hover')}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleProjectChange(project.id)}
                    >
                      <span className="typography-ui-label text-foreground">{project.label || project.path}</span>
                      {project.label ? <span className="truncate typography-micro text-muted-foreground">{project.path}</span> : null}
                    </button>
                  )) : <p className="px-2 py-3 typography-micro text-muted-foreground">{t('taskboard.project.noResults')}</p>}
                </div>
              ) : null}
            </div>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.model')}</span>
              <ModelSelector
                providerId={providerId}
                modelId={modelId}
                directory={directory}
                onChange={(nextProviderId, nextModelId) => {
                  setProviderId(nextProviderId);
                  setModelId(nextModelId);
                  setVariant((current) => Object.prototype.hasOwnProperty.call(
                    providers.find((provider) => provider.id === nextProviderId)?.models?.find((model) => model.id === nextModelId)?.variants || {},
                    current,
                  ) ? current : '');
                }}
                className="w-full"
                dropdownPortalToBody
              />
              <ThinkingPill value={variant} options={variantOptions} disabled={variantOptions.length === 0} onChange={setVariant} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.agent')}</span>
              <AgentSelector
                agentName={agentName}
                directory={directory}
                onChange={setAgentName}
                filter={(agent) => agent.mode === 'primary' || agent.mode === 'all'}
                className="w-full"
                dropdownPortalToBody
              />
            </label>
          </div>

          <label className="flex items-center gap-2">
            <Checkbox checked={permissionAutoAccept} onChange={setPermissionAutoAccept} ariaLabel={t('sessions.scheduledTasks.editor.permissionAutoAccept.aria')} />
            <span className="typography-ui-label font-medium">{t('sessions.scheduledTasks.editor.permissionAutoAccept.label')}</span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={goalEnabled} onChange={setGoalEnabled} ariaLabel={t('taskboard.dialog.fields.goalEnabled')} />
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.goalEnabled')}</span>
          </label>
          {goalEnabled ? (
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('chat.goal.dialog.objectiveLabel')}</span>
              <Textarea value={goalObjective} onChange={(event) => setGoalObjective(event.target.value)} placeholder={t('chat.goal.dialog.objectivePlaceholder')} rows={3} required />
            </label>
          ) : null}

          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface-muted/30 p-3">
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.schedule')}</span>
              <Select<TaskboardScheduleKind> value={scheduleKind} onValueChange={setScheduleKind}>
                <SelectTrigger className="w-full"><SelectValue>{t(`taskboard.dialog.schedule.${scheduleKind}`)}</SelectValue></SelectTrigger>
                <SelectContent>
                  {scheduleKinds.map((value) => <SelectItem key={value} value={value}>{t(`taskboard.dialog.schedule.${value}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            {scheduleKind !== 'none' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {scheduleKind === 'once' ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.date')}</span>
                    <Input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} required />
                  </label>
                ) : null}
                <label className="flex flex-col gap-1.5">
                  <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.time')}</span>
                  <Input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.timezone')}</span>
                  <Input value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} placeholder="UTC" required />
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface-muted/30 p-3">
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.context')}</span>
              <Select<TaskboardContextMode> value={contextMode} onValueChange={(value) => { setContextMode(value); if (value === 'new') { setSourceSessionId(''); setSourceSessionQuery(''); } }}>
                <SelectTrigger className="w-full"><SelectValue>{t(`taskboard.dialog.context.${contextMode}`)}</SelectValue></SelectTrigger>
                <SelectContent>{contextModes.map((value) => <SelectItem key={value} value={value}>{t(`taskboard.dialog.context.${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            {contextMode !== 'new' ? (
              <label className="flex flex-col gap-1.5">
                <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.sourceSession')}</span>
                <div className="relative">
                  <Input
                    value={sourceSessionQuery}
                    onChange={(event) => { setSourceSessionQuery(event.target.value); setSourceSessionPickerOpen(true); }}
                    onFocus={() => setSourceSessionPickerOpen(true)}
                    placeholder={t('taskboard.dialog.sourceSessionPlaceholder')}
                    role="combobox"
                    aria-expanded={sourceSessionPickerOpen}
                    disabled={sourceSessions.length === 0}
                  />
                  {sourceSessionPickerOpen ? (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface-elevated p-1 shadow-lg">
                      {filteredSourceSessions.length > 0 ? filteredSourceSessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={cn('flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-interactive-hover', session.id === sourceSessionId && 'bg-interactive-hover')}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => { setSourceSessionId(session.id); setSourceSessionQuery(sessionLabel(session)); setSourceSessionPickerOpen(false); }}
                        >
                          <span className="typography-ui-label text-foreground">{sessionLabel(session)}</span>
                          <span className="typography-micro text-muted-foreground">{session.id}</span>
                        </button>
                      )) : <p className="px-2 py-3 typography-micro text-muted-foreground">{t('taskboard.dialog.sourceSessionNoResults')}</p>}
                    </div>
                  ) : null}
                </div>
              </label>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.title')}</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('taskboard.dialog.fields.titlePlaceholder')} autoFocus required />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.description')}</span>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('taskboard.dialog.fields.descriptionPlaceholder')} rows={5} simple className="min-h-28 rounded-lg border border-border/60 bg-surface-elevated px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.labels')}</span>
            <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={t('taskboard.dialog.fields.labelsPlaceholder')} />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.priority')}</span>
              <Select<TaskboardPriority> value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full"><SelectValue>{t(`taskboard.priority.${priority}`)}</SelectValue></SelectTrigger>
                <SelectContent>{priorities.map((value) => <SelectItem key={value} value={value}>{t(`taskboard.priority.${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.status')}</span>
              <Select<TaskboardStatus> value={status} onValueChange={setStatus} disabled={isEditing}>
                <SelectTrigger className="w-full"><SelectValue>{t(`taskboard.status.${status}`)}</SelectValue></SelectTrigger>
                <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{t(`taskboard.status.${value}`)}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>
          {validationError ? <p role="alert" className="typography-micro text-[var(--status-error-foreground)]">{validationError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('taskboard.dialog.actions.cancel')}</Button>
            <Button type="submit" disabled={saving || !title.trim() || !selectedProjectId || !providerId || !modelId || !agentName}>
              {saving ? t(isEditing ? 'taskboard.dialog.actions.saving' : 'taskboard.dialog.actions.creating') : t(isEditing ? 'taskboard.dialog.actions.save' : 'taskboard.dialog.actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
