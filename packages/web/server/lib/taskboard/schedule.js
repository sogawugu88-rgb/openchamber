import { DateTime, IANAZone } from 'luxon';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';

const asString = (value) => isString(value) ? String(value).trim() : '';

const defaultTimezone = () => {
  const zoneName = DateTime.local().zoneName;
  return zoneName && IANAZone.isValidZone(zoneName) ? zoneName : 'UTC';
};

const normalizeTimezone = (value) => {
  const timezone = asString(value) || defaultTimezone();
  if (!IANAZone.isValidZone(timezone)) throw new Error('schedule.timezone must be a valid IANA timezone');
  return timezone;
};

const normalizeTime = (value, field) => {
  const time = asString(value);
  if (!TIME_PATTERN.test(time)) throw new Error(`schedule.${field} must be HH:mm`);
  return time;
};

const toMillis = (dateTime, field) => {
  if (!dateTime.isValid) throw new Error(`schedule.${field} is invalid`);
  return dateTime.toMillis();
};

const dateTimeFor = (date, time, timezone, field) => toMillis(
  DateTime.fromFormat(`${date} ${time}`, 'yyyy-LL-dd HH:mm', { zone: timezone }),
  field,
);

export const nextDailyRunAt = (schedule, now = Date.now()) => {
  const current = DateTime.fromMillis(now, { zone: schedule.timezone });
  const time = schedule.time || schedule.times?.[0];
  const [hour, minute] = time.split(':').map(Number);
  const candidate = current.startOf('day').set({ hour, minute, second: 0, millisecond: 0 });
  if (candidate.isValid && candidate.toMillis() > now) return candidate.toMillis();
  return toMillis(
    current.plus({ days: 1 }).startOf('day').set({ hour, minute, second: 0, millisecond: 0 }),
    'time',
  );
};

export const normalizeTaskSchedule = (value, now = Date.now(), preserveState = false) => {
  if (!isRecord(value)) throw new Error('schedule must be an object');
  const kind = asString(value.kind);
  const timezone = normalizeTimezone(value.timezone);
  if (kind === 'once') {
    const date = asString(value.date);
    if (!DATE_PATTERN.test(date)) throw new Error('schedule.date must be YYYY-MM-DD');
    const time = normalizeTime(value.time, 'time');
    const normalized = {
      kind,
      date,
      time,
      timezone,
      lastScheduledFor: preserveState && Number.isFinite(value.lastScheduledFor) ? value.lastScheduledFor : null,
    };
    if (preserveState && Object.prototype.hasOwnProperty.call(value, 'nextRunAt')) normalized.nextRunAt = value.nextRunAt;
    return normalized;
  }
  if (kind === 'daily') {
    const time = normalizeTime(value.time || value.times?.[0], 'time');
    const schedule = { kind, time, timezone };
    return {
      ...schedule,
      nextRunAt: preserveState && Object.prototype.hasOwnProperty.call(value, 'nextRunAt') ? value.nextRunAt : nextDailyRunAt(schedule, now),
      lastScheduledFor: preserveState && Number.isFinite(value.lastScheduledFor) ? value.lastScheduledFor : null,
    };
  }
  throw new Error('schedule.kind must be once or daily');
};

export const isTaskScheduleDue = (schedule, now = Date.now()) => (
  isRecord(schedule)
  && schedule.lastScheduledFor == null
  && (schedule.kind === 'once'
    ? dateTimeFor(schedule.date, schedule.time, schedule.timezone, 'date') <= now
    : Number.isFinite(schedule.nextRunAt) && schedule.nextRunAt <= now)
);

export const markOnceScheduleConsumed = (schedule) => ({
  ...schedule,
  lastScheduledFor: dateTimeFor(schedule.date, schedule.time, schedule.timezone, 'date'),
});

export const advanceDailySchedule = (schedule, now = Date.now()) => ({
  ...schedule,
  lastScheduledFor: schedule.nextRunAt,
  nextRunAt: nextDailyRunAt(schedule, now),
});
