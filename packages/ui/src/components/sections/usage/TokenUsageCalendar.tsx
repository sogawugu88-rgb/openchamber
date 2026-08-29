import React from 'react';
import type { TokenUsageReport } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  buildMonthCalendar,
  formatTokenCount,
  getBucketTotal,
  getRecentUsageDays,
  getSelectedDayModelUsage,
  getUsageIntensity,
} from './tokenUsage';

interface TokenUsageCalendarProps {
  month: string | null;
  report: TokenUsageReport | null;
  loading: boolean;
  onMonthChange: (offset: number) => void;
  onRetry: () => void;
  error: string | null;
  settingsItem?: string;
}

const intensityClasses = [
  'bg-[var(--surface-subtle)]',
  'bg-[color-mix(in_srgb,var(--primary-base)_20%,var(--surface-elevated))]',
  'bg-[color-mix(in_srgb,var(--primary-base)_40%,var(--surface-elevated))]',
  'bg-[color-mix(in_srgb,var(--primary-base)_65%,var(--surface-elevated))]',
  'bg-[var(--primary-base)] text-[var(--primary-foreground)]',
];

const weekdayKeys = [
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.mon',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.tue',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.wed',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.thu',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.fri',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.sat',
  'sessions.scheduledTasks.dialog.schedule.weekdayShort.sun',
] as const;

export const TokenUsageCalendar: React.FC<TokenUsageCalendarProps> = ({
  month,
  report,
  loading,
  onMonthChange,
  onRetry,
  error,
  settingsItem = 'usage.token-calendar',
}) => {
  const { t } = useI18n();
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const cells = month ? buildMonthCalendar(month) : [];
  const maximum = Math.max(...Object.values(report?.days ?? {}).map(getBucketTotal), 0);
  const recentDates = report ? getRecentUsageDays(report, 14) : [];
  const selectedModels = report && selectedDate ? getSelectedDayModelUsage(report, selectedDate) : [];
  const selectedModelsTotal = selectedModels.reduce((sum, model) => sum + model.total, 0);
  const monthLabel = month
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
    : t('settings.usage.tokenUsage.loading');

  React.useEffect(() => {
    setSelectedDate(null);
  }, [month]);

  const formatDate = (dateKey: string): string => new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T00:00:00Z`));

  return (
    <section className="space-y-5 border-t border-border/60 py-8" data-settings-item={settingsItem}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="typography-settings-section-title text-foreground">{t('settings.usage.tokenUsage.title')}</h2>
          <p className="typography-settings-description text-muted-foreground">{t('settings.usage.tokenUsage.timezone', { timezone: report?.timezone ?? 'UTC' })}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={!month} onClick={() => onMonthChange(-1)} aria-label={t('settings.usage.tokenUsage.previousMonth')} title={t('settings.usage.tokenUsage.previousMonth')}>
            <Icon name="arrow-left-s" className="size-4" />
          </Button>
          <span className="min-w-32 text-center typography-ui-label text-foreground">{monthLabel}</span>
          <Button variant="ghost" size="icon" disabled={!month} onClick={() => onMonthChange(1)} aria-label={t('settings.usage.tokenUsage.nextMonth')} title={t('settings.usage.tokenUsage.nextMonth')}>
            <Icon name="arrow-right-s" className="size-4" />
          </Button>
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          <Summary label={t('settings.usage.tokenUsage.today')} value={report.today.total} />
          <Summary label={t('settings.usage.tokenUsage.thisMonth')} value={report.currentMonth.total} />
          <Summary label={t('settings.usage.tokenUsage.total')} value={report.total.total} />
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-4 py-3">
          <p className="typography-meta text-[var(--status-error)]">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>{t('settings.usage.tokenUsage.retry')}</Button>
        </div>
      )}

      {loading && !report ? (
        <p className="typography-ui-label text-muted-foreground">{t('settings.usage.tokenUsage.loading')}</p>
      ) : report ? (
        <div className="space-y-5">
          <div className="grid grid-cols-7 gap-1.5">
            {weekdayKeys.map((key) => <div key={key} className="py-1 text-center typography-micro text-muted-foreground">{t(key)}</div>)}
            {cells.map((cell, index) => {
              const bucket = cell.dateKey ? report.days[cell.dateKey] : undefined;
              const total = getBucketTotal(bucket);
              const intensity = intensityClasses[getUsageIntensity(total, maximum)];
              const selected = cell.dateKey !== null && selectedDate === cell.dateKey;
              if (bucket && cell.dateKey) {
                return (
                  <Button
                    key={`${cell.dateKey}-${index}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'min-h-12 min-w-0 w-full justify-start overflow-hidden rounded-md p-1.5 typography-micro text-left transition-colors',
                      cell.inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                      intensity,
                      selected && 'ring-2 ring-[var(--interactive-focus-ring)] ring-offset-1 ring-offset-[var(--surface-background)]',
                    )}
                    data-token-date={cell.dateKey}
                    aria-label={t('settings.usage.tokenUsage.selectDate', { date: formatDate(cell.dateKey) })}
                    aria-pressed={selected}
                    onClick={() => setSelectedDate((current) => current === cell.dateKey ? null : cell.dateKey)}
                  >
                    {cell.day}
                  </Button>
                );
              }
              return (
                <div key={`${cell.dateKey ?? 'empty'}-${index}`} className={cn('min-h-12 min-w-0 overflow-hidden rounded-md p-1.5 typography-micro', cell.inMonth ? 'text-foreground' : 'text-muted-foreground/50', intensity)}>
                  {cell.day}
                </div>
              );
            })}
          </div>

          {recentDates.length > 0 ? (
            <div data-token-usage-recent-days className="space-y-3">
              <h3 className="typography-settings-group-title text-foreground">{t('settings.usage.tokenUsage.recentDays')}</h3>
              <div className="space-y-1" role="table" aria-label={t('settings.usage.tokenUsage.recentDays')}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2 typography-micro text-muted-foreground" role="row">
                  <span role="columnheader">{t('settings.usage.tokenUsage.date')}</span>
                  <span role="columnheader">{t('settings.usage.tokenUsage.total')}</span>
                </div>
                {recentDates.map((date) => {
                  const total = getBucketTotal(report.days[date]);
                  const isSelected = selectedDate === date;
                  return (
                    <Button
                      key={date}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'grid h-auto min-h-9 w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md px-2 text-left',
                        isSelected && 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]',
                      )}
                      data-token-usage-day={date}
                      aria-label={t('settings.usage.tokenUsage.selectDate', { date: formatDate(date) })}
                      aria-expanded={isSelected}
                      onClick={() => setSelectedDate((current) => current === date ? null : date)}
                    >
                      <span className="min-w-0 truncate tabular-nums">{formatDate(date)}</span>
                      <span className="tabular-nums" title={total.toLocaleString()}>{formatTokenCount(total)}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="typography-ui-label text-muted-foreground">{t('settings.usage.tokenUsage.noData')}</p>
          )}

          {selectedDate ? (
            <section data-token-model-details className="space-y-3 border-t border-border/60 pt-4">
              <h3 className="typography-settings-group-title text-foreground">
                {t('settings.usage.tokenUsage.modelDetailsForDate', { date: formatDate(selectedDate) })}
              </h3>
              {selectedModels.length > 0 ? (
                <div className="space-y-3">
                  <div className="hidden grid-cols-[minmax(0,1fr)_auto] gap-2 px-2 typography-micro text-muted-foreground @xl:grid">
                    <span>{t('settings.usage.tokenUsage.providerModel')}</span>
                    <span>{t('settings.usage.tokenUsage.share')}</span>
                  </div>
                  {selectedModels.map((model) => (
                    <div key={`${model.providerID}/${model.modelID}`} className="space-y-2 border-b border-border/40 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3 px-2">
                        <div className="min-w-0 typography-ui-label break-all text-foreground">{model.providerID} / {model.modelID}</div>
                        <span className="shrink-0 typography-micro tabular-nums text-muted-foreground">
                          {t('settings.usage.tokenUsage.modelShare', { percent: selectedModelsTotal > 0 ? Math.round((model.total / selectedModelsTotal) * 100) : 0 })}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-2 typography-micro @xl:grid-cols-6">
                        <Detail label={t('settings.usage.tokenUsage.total')} value={model.total} />
                        <Detail label={t('contextSidebar.tokens.input')} value={model.input} />
                        <Detail label={t('contextSidebar.tokens.output')} value={model.output} />
                        <Detail label={t('contextSidebar.tokens.reasoning')} value={model.reasoning} />
                        <Detail label={t('contextSidebar.tokens.cacheRead')} value={model.cacheRead} />
                        <Detail label={t('contextSidebar.tokens.cacheWrite')} value={model.cacheWrite} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="typography-ui-label text-muted-foreground">{t('settings.usage.tokenUsage.noModelDetails')}</p>
              )}
            </section>
          ) : null}
        </div>
      ) : !loading ? <p className="typography-ui-label text-muted-foreground">{t('settings.usage.tokenUsage.noData')}</p> : null}
    </section>
  );
};

const Summary: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-border/60 bg-[var(--surface-elevated)] px-4 py-3">
    <p className="typography-meta text-muted-foreground">{label}</p>
    <p className="mt-1 typography-settings-section-title tabular-nums text-foreground">{formatTokenCount(value)}</p>
  </div>
);

const Detail: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span className="flex min-w-0 items-center justify-between gap-2">
    <span className="truncate text-muted-foreground">{label}</span>
    <span className="shrink-0 tabular-nums text-foreground" title={value.toLocaleString()}>{formatTokenCount(value)}</span>
  </span>
);
