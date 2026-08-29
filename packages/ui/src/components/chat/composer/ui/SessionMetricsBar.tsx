import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import { formatSessionTokenCount, shouldRenderSessionMetrics, type SessionMetrics } from '../../sessionMetrics';

type MetricItem = { display: string; full: string };

export interface SessionMetricsBarProps {
    sessionMetrics?: SessionMetrics;
    className?: string;
}

export function SessionMetricsBar({ sessionMetrics, className }: SessionMetricsBarProps) {
    const { t } = useI18n();
    const showSessionTokenDetails = useUIStore((state) => state.showSessionTokenDetails);

    const formatCount = (value: number): string => value.toLocaleString();
    const formatDuration = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
    const metric = (label: string, value: string, fullValue = value): MetricItem => ({
        display: `${label}: ${value}`,
        full: `${label}: ${fullValue}`,
    });
    const plainMetric = (value: string): MetricItem => ({ display: value, full: value });
    const tokenMetric = (label: string, value: number): MetricItem => metric(label, formatSessionTokenCount(value), formatCount(value));
    const metricItems = sessionMetrics ? [
        sessionMetrics.tokens?.total !== undefined ? tokenMetric(t('chat.sessionMetrics.tokens'), sessionMetrics.tokens.total) : null,
        sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.input'), sessionMetrics.tokens.input) : null,
        sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.output'), sessionMetrics.tokens.output) : null,
        sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.reasoning'), sessionMetrics.tokens.reasoning) : null,
        sessionMetrics.tokens ? tokenMetric(t('chat.sessionMetrics.cacheTokens'), sessionMetrics.tokens.cacheRead + sessionMetrics.tokens.cacheWrite) : null,
        sessionMetrics.llmDurationMs !== undefined ? metric(t('chat.sessionMetrics.llm'), formatDuration(sessionMetrics.llmDurationMs)) : null,
        sessionMetrics.ttftMs !== undefined ? metric(t('chat.sessionMetrics.ttft'), formatDuration(sessionMetrics.ttftMs)) : null,
        sessionMetrics.cacheHitPercent !== undefined ? metric(t('chat.sessionMetrics.cache'), `${sessionMetrics.cacheHitPercent.toFixed(1)}%`) : null,
        sessionMetrics.outputTokensPerSecond !== undefined ? plainMetric(`${sessionMetrics.outputTokensPerSecond.toFixed(1)} ${t('chat.sessionMetrics.speed')}`) : null,
    ].filter((item): item is MetricItem => Boolean(item)) : [];

    if (!shouldRenderSessionMetrics(showSessionTokenDetails, metricItems.length)) return null;

    return (
        <div
            className={cn(
                'flex w-full min-w-0 flex-shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-1 text-center typography-micro text-muted-foreground/70',
                className,
            )}
            data-session-metrics="true"
        >
            {metricItems.map((item, index) => (
                <Tooltip key={`${item.display}-${index}`}>
                    <TooltipTrigger asChild>
                        <span
                            className="truncate tabular-nums"
                            tabIndex={0}
                            title={item.full}
                            aria-label={item.full}
                        >
                            {item.display}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[min(80vw,32rem)] break-words">
                        {item.full}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
}
