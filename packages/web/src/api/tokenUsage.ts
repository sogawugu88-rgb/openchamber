import type { TokenUsageAPI, TokenUsageReport } from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
interface JsonObject {
  [key: string]: JsonValue;
}

const isPlainObject = (value: JsonValue): value is JsonObject => value !== null && !Array.isArray(value) && value.constructor === Object;
const isString = (value: JsonValue): value is string => value !== null && value === String(value);
const isFiniteNumber = (value: JsonValue): value is number => value !== null && value === Number(value) && Number.isFinite(value);

const isValidDateKey = (value: string, expectedMonth?: string): boolean => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const month = `${match[1]}-${match[2]}`;
  if (!MONTH_PATTERN.test(month) || (expectedMonth !== undefined && month !== expectedMonth)) return false;
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
};

const parseBucket = (value: JsonValue): TokenUsageReport['total'] | null => {
  if (!isPlainObject(value)) return null;
  const fields = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'];
  if (!fields.every((field) => isFiniteNumber(value[field]))) return null;
  return {
    input: Number(value.input),
    output: Number(value.output),
    reasoning: Number(value.reasoning),
    cacheRead: Number(value.cacheRead),
    cacheWrite: Number(value.cacheWrite),
    total: Number(value.total),
  };
};

const parseTokenUsageReport = (body: string, requestedMonth?: string): TokenUsageReport => {
  const value: JsonValue = JSON.parse(body);
  if (!isPlainObject(value) || !isString(value.timezone) || !isString(value.month) || !MONTH_PATTERN.test(value.month) || (requestedMonth !== undefined && value.month !== requestedMonth) || !isFiniteNumber(value.fetchedAt)) {
    throw new Error('Token usage API returned invalid data format');
  }
  const todayValue = value.today;
  const todayDate = isPlainObject(todayValue) && isString(todayValue.date) && isValidDateKey(todayValue.date) ? todayValue.date : null;
  const today = todayDate === null ? null : parseBucket(todayValue);
  const currentMonth = parseBucket(value.currentMonth);
  const total = parseBucket(value.total);
  if (!today || !currentMonth || !total || !isPlainObject(value.days)) {
    throw new Error('Token usage API returned invalid data format');
  }
  const days: TokenUsageReport['days'] = {};
  for (const [date, bucket] of Object.entries(value.days)) {
    if (!isValidDateKey(date, value.month)) throw new Error('Token usage API returned invalid data format');
    const parsedBucket = parseBucket(bucket);
    if (!parsedBucket) throw new Error('Token usage API returned invalid data format');
    days[date] = parsedBucket;
  }
  return {
    timezone: String(value.timezone),
    month: String(value.month),
    today: { date: String(todayDate), ...today },
    currentMonth,
    total,
    days,
    fetchedAt: Number(value.fetchedAt),
  };
};

export const createWebTokenUsageAPI = (fetchRuntime: typeof runtimeFetch = runtimeFetch): TokenUsageAPI => ({
  async getReport(month?: string): Promise<TokenUsageReport> {
    const response = month === undefined
      ? await fetchRuntime('/api/openchamber/token-usage')
      : await fetchRuntime('/api/openchamber/token-usage', { query: { month } });
    const body = await response.text();
    if (!response.ok) {
      let message = `Token usage API returned ${response.status} ${response.statusText}`;
      try {
        const payload = JSON.parse(body);
        if (payload?.error) message = String(payload.error);
      } catch {
        // Preserve the HTTP failure when the error body is not JSON.
      }
      throw new Error(message);
    }
    return parseTokenUsageReport(body, month);
  },
});
