import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import type { TaskboardPriority, TaskboardStatus, TaskboardTaskInput } from '@/lib/taskboardApi';

type TaskboardTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: TaskboardTaskInput) => Promise<void>;
};

const priorities: TaskboardPriority[] = ['none', 'urgent', 'high', 'medium', 'low'];
const statuses: TaskboardStatus[] = ['backlog', 'todo'];

export function TaskboardTaskDialog({ open, onOpenChange, onSubmit }: TaskboardTaskDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [labels, setLabels] = React.useState('');
  const [priority, setPriority] = React.useState<TaskboardPriority>('none');
  const [status, setStatus] = React.useState<TaskboardStatus>('backlog');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setLabels('');
    setPriority('none');
    setStatus('backlog');
    setSaving(false);
  }, [open]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        title: normalizedTitle,
        description: description.trim(),
        labels: labels.split(',').map((label) => label.trim()).filter(Boolean),
        priority,
        status,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('taskboard.dialog.title')}</DialogTitle>
          <DialogDescription>{t('taskboard.dialog.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.title')}</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('taskboard.dialog.fields.titlePlaceholder')}
              autoFocus
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.description')}</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('taskboard.dialog.fields.descriptionPlaceholder')}
              rows={5}
              simple
              className="min-h-28 rounded-lg border border-border/60 bg-surface-elevated px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.labels')}</span>
            <Input
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder={t('taskboard.dialog.fields.labelsPlaceholder')}
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.priority')}</span>
              <Select<TaskboardPriority> value={priority} onValueChange={(value) => setPriority(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{t(`taskboard.priority.${priority}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((value) => (
                    <SelectItem key={value} value={value}>{t(`taskboard.priority.${value}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="typography-ui-label font-medium">{t('taskboard.dialog.fields.status')}</span>
              <Select<TaskboardStatus> value={status} onValueChange={(value) => setStatus(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{t(`taskboard.status.${status}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((value) => (
                    <SelectItem key={value} value={value}>{t(`taskboard.status.${value}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('taskboard.dialog.actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? t('taskboard.dialog.actions.creating') : t('taskboard.dialog.actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
