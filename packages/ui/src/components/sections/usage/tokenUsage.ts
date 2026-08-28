import type { TokenUsageBucket } from '@/lib/api/types';

export interface CalendarCell {
  dateKey: string | null;
  day: number | null;
  inMonth: boolean;
}

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

interface ParsedMonth {
  year: number;
  month: number;
}

const parseMonthKey = (month: string): ParsedMonth => {
  const match = MONTH_KEY_PATTERN.exec(month);
  if (!match) throw new Error(`Invalid month key: ${month}`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error(`Invalid month key: ${month}`);
  return { year, month: monthNumber };
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const getMonthKey = (month: string, offset: number): string => {
  const parsed = parseMonthKey(month);
  const index = parsed.year * 12 + parsed.month - 1 + offset;
  const year = Math.floor(index / 12);
  const monthNumber = index % 12 + 1;
  return `${year}-${pad(monthNumber)}`;
};

export const buildMonthCalendar = (month: string): CalendarCell[] => {
  const { year, month: monthNumber } = parseMonthKey(month);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const leadingCells = (firstDay + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: CalendarCell[] = [];

  for (let index = 0; index < 42; index += 1) {
    const dayOffset = index - leadingCells;
    if (dayOffset < 0) {
      cells.push({ dateKey: null, day: null, inMonth: false });
      continue;
    }
    const day = dayOffset + 1;
    const cellMonth = day <= daysInMonth ? month : getMonthKey(month, 1);
    const cellDay = day <= daysInMonth ? day : day - daysInMonth;
    cells.push({ dateKey: `${cellMonth}-${pad(cellDay)}`, day: cellDay, inMonth: day <= daysInMonth });
  }

  return cells;
};

export const getUsageIntensity = (total: number, maximum: number): 0 | 1 | 2 | 3 | 4 => {
  if (total <= 0 || maximum <= 0) return 0;
  const ratio = total / maximum;
  if (ratio < 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio < 1) return 3;
  return 4;
};

export const formatTokenCount = (count: number): string => {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${Number((count / 1_000).toFixed(2))}k`;
  if (count < 1_000_000_000) return `${Number((count / 1_000_000).toFixed(2))}M`;
  return `${Number((count / 1_000_000_000).toFixed(2))}B`;
};

export const getBucketTotal = (bucket: TokenUsageBucket | undefined): number => bucket?.total ?? 0;
