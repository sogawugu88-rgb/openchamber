import React from 'react';
import type { TokenUsageAPI, TokenUsageReport } from '@/lib/api/types';
import {
  createTokenUsageRequestCoordinator,
  getMonthKey,
  isTokenUsageReportCurrent,
  isTokenUsageRequestCurrent,
  shouldReloadTokenUsageMonth,
} from './tokenUsage';

export interface UseTokenUsageCalendarOptions {
  enabled?: boolean;
  runtimeKey: string;
  tokenUsage: TokenUsageAPI;
}

export interface UseTokenUsageCalendarResult {
  error: string | null;
  loading: boolean;
  month: string | null;
  onMonthChange: (offset: number) => void;
  report: TokenUsageReport | null;
  retry: () => void;
}

const getClientTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const useTokenUsageCalendar = ({
  enabled = true,
  runtimeKey,
  tokenUsage,
}: UseTokenUsageCalendarOptions): UseTokenUsageCalendarResult => {
  const [tokenMonth, setTokenMonth] = React.useState<string | null>(null);
  const [tokenReport, setTokenReport] = React.useState<{ runtimeKey: string; report: TokenUsageReport } | null>(null);
  const [tokenLoading, setTokenLoading] = React.useState(enabled);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const tokenRequestRef = React.useRef(0);
  const initialRequestStartedRef = React.useRef(false);
  const skipNextMonthRequestRef = React.useRef(false);
  const previousRuntimeKeyRef = React.useRef(runtimeKey);
  const currentRuntimeKeyRef = React.useRef(runtimeKey);
  const tokenRunRef = React.useRef<() => Promise<void>>(() => Promise.resolve());
  const tokenCoordinatorRef = React.useRef(createTokenUsageRequestCoordinator(() => tokenRunRef.current()));

  currentRuntimeKeyRef.current = runtimeKey;

  tokenRunRef.current = React.useCallback(async () => {
    const requestId = ++tokenRequestRef.current;
    setTokenLoading(true);
    setTokenError(null);
    const requestedMonth = tokenMonth;
    const requestRuntimeKey = runtimeKey;
    await tokenUsage.getReport(requestedMonth ?? undefined, getClientTimezone())
      .then((report) => {
        if (!isTokenUsageRequestCurrent(requestId, tokenRequestRef.current, requestRuntimeKey, currentRuntimeKeyRef.current, requestedMonth, tokenMonth)) return;
        if (shouldReloadTokenUsageMonth(requestedMonth, report.month)) {
          setTokenReport(null);
          setTokenMonth(report.month);
          return;
        }
        if (requestedMonth === null) skipNextMonthRequestRef.current = true;
        setTokenMonth(report.month);
        setTokenReport({ runtimeKey, report });
      })
      .catch((cause: unknown) => {
        if (requestId !== tokenRequestRef.current) return;
        setTokenError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (requestId === tokenRequestRef.current) setTokenLoading(false);
      });
  }, [runtimeKey, tokenMonth, tokenUsage]);

  const loadTokenUsage = React.useCallback(() => {
    tokenCoordinatorRef.current.request();
  }, []);

  React.useEffect(() => {
    if (previousRuntimeKeyRef.current !== runtimeKey) {
      previousRuntimeKeyRef.current = runtimeKey;
      tokenRequestRef.current += 1;
      setTokenReport(null);
    }
  }, [runtimeKey]);

  React.useEffect(() => {
    if (!enabled) return;
    if (tokenMonth === null) {
      if (initialRequestStartedRef.current) return;
      initialRequestStartedRef.current = true;
      loadTokenUsage();
      return;
    }
    if (skipNextMonthRequestRef.current) {
      skipNextMonthRequestRef.current = false;
      return;
    }
    loadTokenUsage();
  }, [enabled, loadTokenUsage, runtimeKey, tokenMonth]);

  const onMonthChange = React.useCallback((offset: number) => {
    tokenRequestRef.current += 1;
    skipNextMonthRequestRef.current = false;
    setTokenReport(null);
    setTokenMonth((current) => current ? getMonthKey(current, offset) : current);
  }, []);

  const visibleReport = tokenReport && tokenMonth && isTokenUsageReportCurrent(tokenReport.report, tokenReport.runtimeKey, tokenMonth, runtimeKey)
    ? tokenReport.report
    : null;

  return {
    error: tokenError,
    loading: tokenLoading,
    month: tokenMonth,
    onMonthChange,
    report: visibleReport,
    retry: loadTokenUsage,
  };
};
