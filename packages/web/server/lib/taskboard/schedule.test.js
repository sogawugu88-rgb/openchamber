import { describe, expect, it } from 'vitest';

import {
  advanceDailySchedule,
  isTaskScheduleDue,
  markOnceScheduleConsumed,
  normalizeTaskSchedule,
  nextDailyRunAt,
} from './schedule.js';

describe('taskboard schedules', () => {
  it('normalizes one-time schedules in their configured timezone', () => {
    const schedule = normalizeTaskSchedule({
      kind: 'once',
      date: '2026-09-01',
      time: '09:30',
      timezone: 'Europe/Kyiv',
    }, Date.parse('2026-08-31T00:00:00Z'));

    expect(schedule).toMatchObject({ kind: 'once', date: '2026-09-01', time: '09:30', timezone: 'Europe/Kyiv' });
    expect(isTaskScheduleDue(schedule, Date.parse('2026-09-01T06:30:00Z'))).toBe(true);
    expect(markOnceScheduleConsumed(schedule)).toMatchObject({ lastScheduledFor: Date.parse('2026-09-01T06:30:00Z') });
  });

  it('rolls daily schedules forward after the configured slot', () => {
    const schedule = normalizeTaskSchedule({ kind: 'daily', time: '17:30', timezone: 'UTC' }, Date.parse('2026-09-01T10:00:00Z'));
    expect(schedule.nextRunAt).toBe(Date.parse('2026-09-01T17:30:00Z'));
    expect(nextDailyRunAt(schedule, Date.parse('2026-09-01T18:00:00Z'))).toBe(Date.parse('2026-09-02T17:30:00Z'));
    expect(advanceDailySchedule({ ...schedule, nextRunAt: Date.parse('2026-09-01T17:30:00Z') }, Date.parse('2026-09-01T18:00:00Z'))).toMatchObject({
      lastScheduledFor: Date.parse('2026-09-01T17:30:00Z'),
      nextRunAt: Date.parse('2026-09-02T17:30:00Z'),
    });
  });

  it('rejects invalid times and timezones', () => {
    expect(() => normalizeTaskSchedule({ kind: 'daily', time: '25:00', timezone: 'UTC' })).toThrow('schedule.time');
    expect(() => normalizeTaskSchedule({ kind: 'daily', time: '09:00', timezone: 'Mars/Olympus' })).toThrow('schedule.timezone');
  });

  it('does not trust persisted occurrence state from a new task payload', () => {
    const schedule = normalizeTaskSchedule({
      kind: 'daily',
      time: '09:00',
      timezone: 'UTC',
      nextRunAt: 0,
      lastScheduledFor: Date.parse('2026-09-01T09:00:00Z'),
    }, Date.parse('2026-09-01T08:00:00Z'));

    expect(schedule.lastScheduledFor).toBeNull();
    expect(schedule.nextRunAt).toBe(Date.parse('2026-09-01T09:00:00Z'));
  });
});
