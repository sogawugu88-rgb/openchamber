import type { Message } from '@opencode-ai/sdk/v2';
import { deriveMessageRole } from './message/messageRole';

type TokenCache = { read?: number; write?: number };
type TokenPayload = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: TokenCache;
};
type MessageTime = { created?: number; completed?: number };
type PartTime = { start?: number; end?: number };
type SessionMetricPart = { type: string; tokens?: TokenPayload; time?: PartTime & { created?: number } };

export type SessionMessageRecord = {
  info: Pick<Message, 'id'> & {
    role?: Message['role'];
    clientRole?: string;
    modelID?: string;
    tokens?: TokenPayload;
    time?: MessageTime;
  };
  parts: SessionMetricPart[];
};

export type SessionTimingProjection = {
  ttftMs?: readonly number[];
  decodeSeconds?: number;
  llmDurationMs?: number;
};

export type SessionMetrics = {
  turns: number;
  steps: number;
  model?: string;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  llmDurationMs?: number;
  toolDurationMs?: number;
  ttftMs?: number;
  cacheHitPercent?: number;
  outputTokensPerSecond?: number;
};

const finiteNonNegative = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return value;
};

const readTokens = (record: SessionMessageRecord): TokenPayload | null => {
  const direct = record.info.tokens;
  if (direct) return direct;
  const part = record.parts.find((entry) => entry.tokens !== undefined)?.tokens;
  return part ?? null;
};

const completeDuration = (start: number | undefined, end: number | undefined): number | null => {
  if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return end - start;
};

export const deriveSessionMetrics = (
  messages: readonly SessionMessageRecord[],
  timing: SessionTimingProjection,
): SessionMetrics => {
  let steps = 0;
  let turns = 0;
  let model: string | undefined;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let llmDurationMs = 0;
  let toolDurationMs = 0;
  let hasLlmDuration = false;
  let hasToolDuration = false;
  const derivedTtft: number[] = [];
  let derivedDecodeSeconds = 0;

  for (const record of messages) {
    // The role helper also handles clientRole and user markers from optimistic
    // and older wire records, where Message.role can be absent.
    // SAFETY: deriveMessageRole only reads role compatibility fields from this
    // record; the full SDK message payload is not needed for classification.
    const role = deriveMessageRole(record.info as Message);
    if (role.isUser) {
      turns += 1;
    }
    if (role.role !== 'assistant') continue;

    steps += 1;
    model = record.info.modelID?.trim() || model;
    const tokens = readTokens(record);
    if (tokens) {
      input += finiteNonNegative(tokens.input);
      output += finiteNonNegative(tokens.output);
      reasoning += finiteNonNegative(tokens.reasoning);
      cacheRead += finiteNonNegative(tokens.cache?.read);
      cacheWrite += finiteNonNegative(tokens.cache?.write);
    }

    const messageDuration = completeDuration(record.info.time?.created, record.info.time?.completed);
    if (messageDuration !== null) {
      llmDurationMs += messageDuration;
      hasLlmDuration = true;
    }
    const generatedParts = record.parts.filter((part) => part.type === 'text' || part.type === 'reasoning');
    const firstGeneratedAt = generatedParts.reduce<number | undefined>((earliest, part) => (
      part.time?.start !== undefined && Number.isFinite(part.time.start)
        ? Math.min(earliest ?? part.time.start, part.time.start)
        : earliest
    ), undefined);
    if (firstGeneratedAt !== undefined && record.info.time?.created !== undefined && firstGeneratedAt >= record.info.time.created) {
      derivedTtft.push(firstGeneratedAt - record.info.time.created);
    }
    for (const part of generatedParts) {
      const duration = completeDuration(part.time?.start, part.time?.end);
      if (duration !== null) derivedDecodeSeconds += duration / 1000;
    }
    for (const part of record.parts) {
      if (part.type !== 'tool') continue;
      const duration = completeDuration(part.time?.start, part.time?.end);
      if (duration !== null) {
        toolDurationMs += duration;
        hasToolDuration = true;
      }
    }
  }

  const totalInput = input + cacheRead + cacheWrite;
  const validTtft = (timing.ttftMs ?? derivedTtft).filter((value) => Number.isFinite(value) && value >= 0);
  const decodeSeconds = timing.decodeSeconds ?? derivedDecodeSeconds;
  const metrics: SessionMetrics = { turns, steps };
  if (model) metrics.model = model;
  if (steps > 0 && (input + output + reasoning + cacheRead + cacheWrite > 0)) {
    metrics.tokens = { input, output, reasoning, cacheRead, cacheWrite };
  }
  const projectedLlmDuration = timing.llmDurationMs;
  // The activity projection is latest-turn-only, so it is authoritative only
  // when this session fold contains exactly one assistant step.
  if (steps === 1 && projectedLlmDuration !== undefined && Number.isFinite(projectedLlmDuration) && projectedLlmDuration >= 0) {
    metrics.llmDurationMs = projectedLlmDuration;
  } else if (hasLlmDuration) {
    metrics.llmDurationMs = llmDurationMs;
  }
  if (hasToolDuration) metrics.toolDurationMs = toolDurationMs;
  if (validTtft.length > 0) metrics.ttftMs = validTtft.reduce((sum, value) => sum + value, 0) / validTtft.length;
  if (totalInput > 0 && cacheRead > 0) metrics.cacheHitPercent = (cacheRead / totalInput) * 100;
  if (output > 0 && Number.isFinite(decodeSeconds) && decodeSeconds > 0) {
    metrics.outputTokensPerSecond = output / decodeSeconds;
  }
  return metrics;
};
