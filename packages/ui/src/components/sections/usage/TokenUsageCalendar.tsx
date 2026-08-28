import React from 'react';
import type { TokenUsageReport } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { buildMonthCalendar, formatTokenCount, getBucketTotal, getUsageIntensity } from './tokenUsage';

interface TokenUsageCalendarProps {
  month: string | null;
  report: TokenUsageReport | null;
  loading: boolean;
  onMonthChange: (offset: number) => void;
  onRetry: () => void;
  error: string | null;
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
}) => {
  const { t } = useI18n();
  const cells = month ? buildMonthCalendar(month) : [];
  const maximum = Math.max(...Object.values(report?.days ?? {}).map(getBucketTotal), 0);
  const monthLabel = month
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
    : t('settings.usage.tokenUsage.loading');

  return (
    <section className="space-y-5 border-t border-border/60 py-8" data-settings-item="usage.token-calendar">
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
      ) : report && Object.keys(report.days).length > 0 ? (
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-1.5">
            {weekdayKeys.map((key) => <div key={key} className="py-1 text-center typography-micro text-muted-foreground">{t(key)}</div>)}
            {cells.map((cell, index) => {
              const bucket = cell.dateKey ? report.days[cell.dateKey] : undefined;
              const total = getBucketTotal(bucket);
              return (
                <div key={`${cell.dateKey ?? 'empty'}-${index}`} className={cn('min-h-12 rounded-md p-1.5 typography-micro', cell.inMonth ? 'text-foreground' : 'text-muted-foreground/50', intensityClasses[getUsageIntensity(total, maximum)])}>
                  {cell.day}
                  {bucket && total > 0 ? <span className="block tabular-nums">{formatTokenCount(total)}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : !loading ? (
        <p className="typography-ui-label text-muted-foreground">{t('settings.usage.tokenUsage.noData')}</p>
      ) : null}
    </section>
  );
};

const Summary: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-border/60 bg-[var(--surface-elevated)] px-4 py-3">
    <p className="typography-meta text-muted-foreground">{label}</p>
    <p className="mt-1 typography-settings-section-title tabular-nums text-foreground">{formatTokenCount(value)}</p>
  </div>
);
