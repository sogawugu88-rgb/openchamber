import { describe, expect, test } from 'bun:test';

import { deriveSessionMetrics, type SessionMessageRecord, type SessionTimingProjection } from './sessionMetrics';

const assistant = (
  id: string,
  tokens: Record<string, number | { read?: number; write?: number }>,
  modelID = 'claude-sonnet',
  created = 1_000,
  completed = 3_000,
  parts: SessionMessageRecord['parts'] = [],
): SessionMessageRecord => ({
  info: { id, role: 'assistant', modelID, tokens, time: { created, completed } },
  parts,
});

const user = (id: string): SessionMessageRecord => ({
  info: { id, role: 'user', time: { created: 500 } },
  parts: [],
});

describe('deriveSessionMetrics', () => {
  test('folds turns, steps, model, token buckets, tool time, average TTFT, cache hit, and decode speed', () => {
    const messages: SessionMessageRecord[] = [
      user('user-1'),
      assistant('assistant-1', { input: 100, output: 40, reasoning: 10, cache: { read: 50, write: 10 } }, 'model-a', 1_000, 2_000, [
        { type: 'tool', time: { start: 1_200, end: 1_700 } },
      ]),
      user('user-2'),
      assistant('assistant-2', { input: 300, output: 60, reasoning: 20, cache: { read: 100, write: 20 } }, 'model-a', 4_000, 7_000, [
        { type: 'tool', time: { start: 4_500, end: 5_500 } },
      ]),
    ];
    const timing: SessionTimingProjection = {
      ttftMs: [200, 400],
      decodeSeconds: 4,
    };

    expect(deriveSessionMetrics(messages, timing)).toEqual({
      turns: 2,
      steps: 2,
      model: 'model-a',
      tokens: { input: 400, output: 100, reasoning: 30, cacheRead: 150, cacheWrite: 30 },
      llmDurationMs: 4_000,
      toolDurationMs: 1_500,
      ttftMs: 300,
      cacheHitPercent: 25.862068965517242,
      outputTokensPerSecond: 25,
    });
  });

  test('omits speed for zero or absent decode duration and excludes incomplete timings', () => {
    const messages: SessionMessageRecord[] = [
      assistant('complete', { input: 10, output: 5, reasoning: 1, cache: { read: 4, write: 1 } }, 'model-a', 1_000, 2_000, [
        { type: 'tool', time: { start: 1_100 } },
      ]),
      assistant('incomplete', { input: 20, output: 10, reasoning: 2, cache: { read: 5, write: 2 } }, 'model-b', 3_000, undefined, [
        { type: 'tool', time: { start: 3_100, end: 4_100 } },
      ]),
    ];

    expect(deriveSessionMetrics(messages, { decodeSeconds: 0 })).toEqual({
      turns: 0,
      steps: 2,
      model: 'model-b',
      tokens: { input: 30, output: 15, reasoning: 3, cacheRead: 9, cacheWrite: 3 },
      llmDurationMs: 1_000,
      toolDurationMs: 1_000,
      cacheHitPercent: 21.428571428571427,
    });
    expect(deriveSessionMetrics([], {})).toEqual({ turns: 0, steps: 0 });
  });

  test('omits speed when output tokens exist but decode duration is absent', () => {
    expect(deriveSessionMetrics([
      assistant('output-only', { output: 25 }),
    ], {})).toEqual({
      turns: 0,
      steps: 1,
      model: 'claude-sonnet',
      tokens: { input: 0, output: 25, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      llmDurationMs: 2_000,
    });
  });

  test('uses compatible client roles when the server role is absent', () => {
    // SAFETY: this fixture intentionally models the wire shape with no server role.
    const userMessage = {
      info: { id: 'wire-user', clientRole: 'user', time: { created: 500 } },
      parts: [],
    } as SessionMessageRecord;
    // SAFETY: this fixture intentionally models the wire shape with no server role.
    const assistantMessage = {
      info: { id: 'wire-assistant', clientRole: 'assistant', modelID: 'model-a', tokens: { output: 5 } },
      parts: [],
    } as SessionMessageRecord;

    expect(deriveSessionMetrics([userMessage, assistantMessage], {})).toEqual({
      turns: 1,
      steps: 1,
      model: 'model-a',
      tokens: { input: 0, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  test('prefers a valid projected LLM duration over message timestamps', () => {
    const metrics = deriveSessionMetrics([
      assistant('timed', { output: 10 }, 'model-a', 1_000, 9_000),
    ], { llmDurationMs: 1_500 });

    expect(metrics.llmDurationMs).toBe(1_500);
  });

  test('keeps the full-session LLM duration across multiple assistant turns', () => {
    const metrics = deriveSessionMetrics([
      assistant('first', { output: 10 }, 'model-a', 1_000, 3_000),
      assistant('second', { output: 20 }, 'model-a', 4_000, 9_000),
    ], { llmDurationMs: 1_500 });

    expect(metrics.llmDurationMs).toBe(7_000);
  });

  test('supports numeric token payloads as total-only token metrics', () => {
    // SAFETY: this fixture intentionally models the legacy numeric token wire shape.
    const numericMessage = {
      info: { id: 'numeric', role: 'assistant', modelID: 'model-a', tokens: 123 },
      parts: [],
    } as SessionMessageRecord;

    expect(deriveSessionMetrics([numericMessage], {})).toEqual({
      turns: 0,
      steps: 1,
      model: 'model-a',
      tokens: { total: 123, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  test('preserves finite object token totals alongside bucket values', () => {
    // SAFETY: this fixture intentionally models the server token payload with a total field.
    const objectMessage = {
      info: { id: 'object-total', role: 'assistant', tokens: { total: 123, input: 10, output: 5 } },
      parts: [],
    } as SessionMessageRecord;

    expect(deriveSessionMetrics([objectMessage], {})).toEqual({
      turns: 0,
      steps: 1,
      tokens: { total: 123, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cacheHitPercent: 0,
    });
  });

  test('reports zero cache hit when positive input has no cache reads', () => {
    const metrics = deriveSessionMetrics([
      assistant('no-cache', { input: 100, output: 5, cache: { read: 0, write: 0 } }),
    ], {});

    expect(metrics.cacheHitPercent).toBe(0);
  });
});
