import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 2_147_483_647;
const MAX_RETRY_DELAY_WITHOUT_HEADER_MS = 30_000;
const MAX_PROMPT_LENGTH = 2_000;
const MAX_RECOVERY_CHECKS_PER_ERROR = 15;
const ACCEPTED_RECOVERY_WATCHDOG_MS = 5 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MESSAGE_FETCH_LIMIT = 40;
const FETCH_TIMEOUT_MS = 10_000;

const DEFAULT_CONTINUATION_PROMPT = [
  'The previous model attempt was interrupted by a provider rate limit.',
  'Continue executing the previous task from the current workspace state.',
  'Do not repeat completed work. Verify the current state and continue.',
].join(' ');

const RETRYABLE_STATUS_CODES = new Set([429]);
const RETRYABLE_MESSAGE_PATTERN = /429|too many requests|rate[-_ ]limit(?:ed|_exceeded)?|rate increased too quickly/i;
const PERMANENT_QUOTA_PATTERN = /FreeUsageLimitError|GoUsageLimitError|free usage|quota(?:\s|_|-)exceeded|usage limit/i;

const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const asString = (value) => isString(value) ? String(value) : '';

const extractSessionStatus = (payload) => {
  if (!isRecord(payload) || payload.type !== 'session.status') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const status = isRecord(properties.status) ? properties.status : {};
  const info = isRecord(properties.info) ? properties.info : {};
  const sessionId = asString(properties.sessionID).trim();
  const type = asString(status.type).trim() || asString(info.type).trim();
  if (!sessionId || !type) return null;
  const directory = asString(properties.directory) || asString(info.directory);
  return { sessionId, type, directory };
};

const extractMessageUpdate = (payload) => {
  if (!isRecord(payload) || payload.type !== 'message.updated') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const info = isRecord(properties.info) ? properties.info : {};
  const sessionId = asString(info.sessionID).trim();
  const messageId = asString(info.id).trim();
  if (!sessionId || !messageId) return null;
  return { sessionId, info };
};

const extractSessionUpdate = (payload) => {
  if (!isRecord(payload) || payload.type !== 'session.updated') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const info = isRecord(properties.info) ? properties.info : {};
  const sessionId = asString(info.id).trim() || asString(properties.sessionID).trim();
  if (!sessionId) return null;
  const goal = info.metadata?.openchamber?.goal;
  return { sessionId, reverted: isRecord(info.revert), activeGoal: isRecord(goal) && goal.status === 'active' };
};

const extractMessageRemoval = (payload) => {
  if (!isRecord(payload) || payload.type !== 'message.removed') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const sessionId = asString(properties.sessionID).trim();
  const messageId = asString(properties.messageID).trim();
  if (!sessionId || !messageId) return null;
  return { sessionId, messageId };
};

const extractSessionRemoval = (payload) => {
  if (!isRecord(payload) || payload.type !== 'session.deleted') return null;
  const properties = isRecord(payload.properties) ? payload.properties : {};
  const sessionId = asString(properties.sessionID).trim();
  return sessionId ? { sessionId } : null;
};

const errorText = (error) => {
  if (!isRecord(error)) return '';
  const data = isRecord(error.data) ? error.data : {};
  return [error.message, data.message, data.responseBody].filter(isString).join('\n');
};

const errorStatus = (error) => {
  if (!isRecord(error)) return undefined;
  const data = isRecord(error.data) ? error.data : {};
  return Number.isFinite(data.statusCode) ? data.statusCode : undefined;
};

const isRateLimitError = (error) => {
  const text = errorText(error);
  if (PERMANENT_QUOTA_PATTERN.test(text)) return false;
  const status = errorStatus(error);
  return (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) || RETRYABLE_MESSAGE_PATTERN.test(text);
};

const isAbortedError = (error) => isRecord(error) && error.name === 'MessageAbortedError';

const parseRetryAfterMs = (error) => {
  if (!isRecord(error)) return undefined;
  const data = isRecord(error.data) ? error.data : {};
  const headers = isRecord(data.responseHeaders) ? data.responseHeaders : {};
  const retryAfterMs = Number(headers['retry-after-ms']);
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }

  const retryAfter = asString(headers['retry-after']).trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
    }
  }

  return undefined;
};

const normalizeSettings = (settings) => {
  const input = isRecord(settings) ? settings : {};
  const rawMaxRetries = Number.isFinite(input.sessionAutoContinueMaxRetries)
    ? Math.floor(input.sessionAutoContinueMaxRetries)
    : DEFAULT_MAX_RETRIES;
  const prompt = asString(input.sessionAutoContinuePrompt).trim();
  return {
    enabled: input.sessionAutoContinueEnabled !== false,
    maxRetries: Math.max(0, rawMaxRetries),
    prompt: (prompt || DEFAULT_CONTINUATION_PROMPT).slice(0, MAX_PROMPT_LENGTH),
  };
};

const isActiveGoal = (session) => {
  const goal = session?.metadata?.openchamber?.goal;
  return isRecord(goal) && goal.status === 'active';
};

const isWorkingStatus = (status) => status?.type === 'busy' || status?.type === 'retry';

const messageCompleted = (info) => Number.isFinite(info?.time?.completed) && info.time.completed > 0;

const getMessageModel = (info, fallback) => {
  const model = isRecord(info?.model) ? info.model : {};
  const providerID = asString(model.providerID) || asString(info?.providerID) || asString(fallback?.providerID);
  const modelID = asString(model.modelID) || asString(model.id) || asString(info?.modelID) || asString(fallback?.modelID);
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
};

const createMessageID = () => `msg_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '')}`;

export const createSessionAutoRetryRuntime = ({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  readSettings = async () => ({}),
  fetchImpl = fetch,
}) => {
  const states = new Map();
  const latestUserMessages = new Map();
  const latestUserMessageTimers = new Map();
  let stopped = false;

  const rememberLatestUserMessage = (sessionId, messageId, createdAt) => {
    const normalizedCreatedAt = Number.isFinite(createdAt) ? createdAt : Date.now();
    const previous = latestUserMessages.get(sessionId);
    if (previous && normalizedCreatedAt < previous.createdAt) return;
    const previousTimer = latestUserMessageTimers.get(sessionId);
    if (previousTimer) clearTimeout(previousTimer);
    const record = { id: messageId, createdAt: normalizedCreatedAt };
    latestUserMessages.set(sessionId, record);
    const timer = setTimeout(() => {
      const current = latestUserMessages.get(sessionId);
      if (current?.id === messageId && current.createdAt === normalizedCreatedAt) latestUserMessages.delete(sessionId);
      latestUserMessageTimers.delete(sessionId);
    }, STATE_TTL_MS);
    timer?.unref?.();
    latestUserMessageTimers.set(sessionId, timer);
  };

  const clearRetryTimer = (state) => {
    if (!state?.timer) return;
    clearTimeout(state.timer);
    state.timer = null;
  };

  const clearAcceptedTimer = (state) => {
    if (!state?.acceptedTimer) return;
    clearTimeout(state.acceptedTimer);
    state.acceptedTimer = null;
  };

  const clearTimers = (state) => {
    clearRetryTimer(state);
    clearAcceptedTimer(state);
    if (state?.exhaustedTimer) {
      clearTimeout(state.exhaustedTimer);
      state.exhaustedTimer = null;
    }
  };

  const clearState = (sessionId) => {
    const state = states.get(sessionId);
    if (!state) return;
    clearTimers(state);
    state.controller?.abort();
    states.delete(sessionId);
  };

  const markExhausted = (state) => {
    if (!state || state.exhausted) return;
    clearTimers(state);
    state.exhausted = true;
    state.exhaustedTimer = setTimeout(() => {
      if (states.get(state.sessionId) === state) clearState(state.sessionId);
    }, STATE_TTL_MS);
    state.exhaustedTimer?.unref?.();
  };

  const openCodeFetch = async (fetchPath, { directory, method = 'GET', body, query, signal } = {}) => {
    const base = buildOpenCodeUrl(fetchPath, '');
    const params = new URLSearchParams(query || {});
    if (directory) params.set('directory', directory);
    const search = params.toString();
    const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
    const headers = { Accept: 'application/json', ...getOpenCodeAuthHeaders() };
    const request = { method, headers, signal: requestSignal };
    if (body) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${base}${search ? `?${search}` : ''}`, request);
    if (!response.ok) {
      const error = new Error(`OpenCode ${method} ${fetchPath} failed with ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  };

  const fallbackDelay = (attempt) => {
    return Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_WITHOUT_HEADER_MS);
  };

  const nextDelay = (state) => parseRetryAfterMs(state.pendingError) ?? fallbackDelay(state.attempts);

  const arm = (state) => {
    if (
      stopped
      || !state
      || state.working
      || state.waitingForContinuation
      || state.inflight
      || state.timer
      || state.exhausted
      || !state.currentUserMessageID
    ) return;
    const next = Date.now() + nextDelay(state);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (stopped || states.get(state.sessionId) !== state || state.inflight || state.exhausted) return;
      state.inflight = true;
      retrySession(state)
        .catch((error) => {
          if (states.get(state.sessionId) !== state) return;
          console.warn('[session-auto-retry] recovery failed:', error?.message || error);
          state.working = false;
          state.pendingError = error;
          if (state.attempts >= state.settingsMaxRetries || state.checks >= MAX_RECOVERY_CHECKS_PER_ERROR) {
            markExhausted(state);
          }
        })
        .finally(() => {
          state.inflight = false;
          if (states.get(state.sessionId) === state && state.pendingError && !state.exhausted && !state.working) {
            arm(state);
          }
        });
    }, Math.max(0, next - Date.now()));
    state.timer?.unref?.();
  };

  const fetchSession = (state) => openCodeFetch(`/session/${encodeURIComponent(state.sessionId)}`, {
    directory: state.directory,
    signal: state.controller.signal,
  });

  const fetchStatuses = async (state) => {
    const statuses = await openCodeFetch('/session/status', {
      directory: state.directory,
      signal: state.controller.signal,
    });
    return isRecord(statuses) && !Array.isArray(statuses) ? statuses : null;
  };

  const fetchMessages = async (state) => {
    const messages = await openCodeFetch(`/session/${encodeURIComponent(state.sessionId)}/message`, {
      directory: state.directory,
      query: { limit: String(MESSAGE_FETCH_LIMIT) },
      signal: state.controller.signal,
    });
    return Array.isArray(messages) ? messages : null;
  };

  const findLastUserMessage = (messages) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.info?.role === 'user') return messages[index];
    }
    return null;
  };

  const findLatestAssistantForUser = (messages, userMessageID) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const info = messages[index]?.info;
      if (info?.role === 'assistant' && info.parentID === userMessageID) return messages[index];
    }
    return null;
  };

  const readCurrentSettings = async () => {
    const current = await readSettings().catch(() => null);
    return current ? normalizeSettings(current) : null;
  };

  async function retrySession(state) {
    if (states.get(state.sessionId) !== state) return;
    const settings = await readCurrentSettings();
    if (!settings || !settings.enabled || state.attempts >= settings.maxRetries) {
      markExhausted(state);
      return;
    }
    state.settingsMaxRetries = settings.maxRetries;
    if (state.checks >= MAX_RECOVERY_CHECKS_PER_ERROR) {
      markExhausted(state);
      return;
    }
    state.checks += 1;

    let session;
    try {
      session = await fetchSession(state);
    } catch (error) {
      if (error?.status === 404) {
        clearState(state.sessionId);
        return;
      }
      throw error;
    }
    if (!session || isActiveGoal(session) || asString(session.parentID) || isRecord(session.revert)) {
      clearState(state.sessionId);
      return;
    }

    const statuses = await fetchStatuses(state);
    if (!statuses) throw new Error('OpenCode status unavailable');
    if (isWorkingStatus(statuses[state.sessionId])) {
      state.working = false;
      return;
    }

    const messages = await fetchMessages(state);
    if (!messages) throw new Error('OpenCode messages unavailable');
    const lastUser = findLastUserMessage(messages);
    if (!lastUser || lastUser.info?.id !== state.currentUserMessageID) {
      clearState(state.sessionId);
      return;
    }

    const latestAssistant = findLatestAssistantForUser(messages, state.currentUserMessageID);
    if (!latestAssistant) {
      state.working = false;
      return;
    }
    if (!latestAssistant.info.error) {
      if (!messageCompleted(latestAssistant.info)) {
        state.working = true;
        return;
      }
      clearState(state.sessionId);
      return;
    }
    if (!messageCompleted(latestAssistant.info)) {
      state.working = false;
      return;
    }
    if (!isRateLimitError(latestAssistant.info.error)) {
      clearState(state.sessionId);
      return;
    }

    if (states.get(state.sessionId) !== state) return;
    const info = latestAssistant?.info || {};
    const model = getMessageModel(info, state);
    if (!model) {
      markExhausted(state);
      return;
    }
    const continuationMessageID = createMessageID();
    const body = {
      messageID: continuationMessageID,
      model,
      parts: [{ type: 'text', text: settings.prompt, synthetic: true }],
    };
    const agent = asString(info.agent) || asString(info.mode) || asString(state.agent);
    const variant = asString(info.variant) || asString(state.variant);
    if (agent) body.agent = agent;
    if (variant) body.variant = variant;

    state.currentUserCreatedAt = Number.isFinite(lastUser.info?.time?.created)
      ? lastUser.info.time.created
      : Date.now();
    state.attempts += 1;
    state.checks = 0;
    state.pendingError = null;
    state.expectedContinuationMessageID = continuationMessageID;
    state.waitingForContinuation = true;
    state.working = true;
    try {
      await openCodeFetch(`/session/${encodeURIComponent(state.sessionId)}/prompt_async`, {
        directory: state.directory,
        method: 'POST',
        body,
        signal: state.controller.signal,
      });
      if (states.get(state.sessionId) !== state) return;
      state.acceptedTimer = setTimeout(() => {
        if (states.get(state.sessionId) === state && state.waitingForContinuation) {
          console.warn(`[session-auto-retry] ${state.sessionId} continuation produced no terminal event`);
          markExhausted(state);
        }
      }, ACCEPTED_RECOVERY_WATCHDOG_MS);
      state.acceptedTimer?.unref?.();
    } catch (error) {
      // The async request may have reached OpenCode before the client saw the
      // failure. Do not issue another request with a new message ID.
      state.working = false;
      state.waitingForContinuation = false;
      state.ambiguousContinuationMessageID = continuationMessageID;
      state.pendingError = error;
      markExhausted(state);
    }
  }

  const createState = (sessionId, directory, info, userMessageID) => ({
    sessionId,
    directory,
    currentUserMessageID: userMessageID,
    currentUserCreatedAt: 0,
    assistantMessageID: asString(info.id),
    expectedContinuationMessageID: '',
    ambiguousContinuationMessageID: '',
    attempts: 0,
    checks: 0,
    settingsMaxRetries: DEFAULT_MAX_RETRIES,
    working: false,
    waitingForContinuation: false,
    inflight: false,
    timer: null,
    acceptedTimer: null,
    exhaustedTimer: null,
    exhausted: false,
    pendingError: info.error,
    errorObservedAt: Date.now(),
    providerID: asString(info.providerID),
    modelID: asString(info.modelID),
    agent: asString(info.agent) || asString(info.mode),
    variant: asString(info.variant),
    controller: new AbortController(),
  });

  const processPayload = (payload, directoryHint = '') => {
    if (stopped) return;

    const status = extractSessionStatus(payload);
    if (status) {
      const state = states.get(status.sessionId);
      if (!state) return;
      if (status.directory) state.directory = status.directory;
      if (isWorkingStatus({ type: status.type })) {
        state.working = true;
        clearRetryTimer(state);
      } else if (status.type === 'idle') {
        if (state.waitingForContinuation && !state.pendingError) return;
        state.working = false;
        arm(state);
      }
      return;
    }

    const sessionUpdate = extractSessionUpdate(payload);
    if (sessionUpdate) {
      if (sessionUpdate.reverted || sessionUpdate.activeGoal) clearState(sessionUpdate.sessionId);
      return;
    }

    const sessionRemoval = extractSessionRemoval(payload);
    if (sessionRemoval) {
      clearState(sessionRemoval.sessionId);
      return;
    }

    const removal = extractMessageRemoval(payload);
    if (removal) {
      const state = states.get(removal.sessionId);
      if (state && (
        state.currentUserMessageID === removal.messageId
        || state.expectedContinuationMessageID === removal.messageId
        || state.assistantMessageID === removal.messageId
      )) clearState(removal.sessionId);
      return;
    }

    const update = extractMessageUpdate(payload);
    if (!update) return;
    const info = update.info;
    const current = states.get(update.sessionId);
    if (info.role === 'user') {
      const createdAt = Number.isFinite(info.time?.created) ? info.time.created : Date.now();
      rememberLatestUserMessage(update.sessionId, info.id, createdAt);
      if (!current) return;
      if (current.ambiguousContinuationMessageID === info.id) return;
      if (current.waitingForContinuation) {
        if (info.id === current.expectedContinuationMessageID) {
          current.currentUserMessageID = info.id;
          current.currentUserCreatedAt = createdAt;
          current.waitingForContinuation = false;
          current.working = true;
        } else if (createdAt > current.currentUserCreatedAt) {
          clearState(update.sessionId);
        }
        return;
      }
      if (current.currentUserMessageID !== info.id && createdAt >= current.errorObservedAt) {
        clearState(update.sessionId);
      }
      return;
    }
    if (info.role !== 'assistant') return;

    const parentID = asString(info.parentID);
    if (current?.ambiguousContinuationMessageID === parentID) return;
    if (isAbortedError(info.error)) {
      clearState(update.sessionId);
      return;
    }
    if (current?.waitingForContinuation) {
      if (parentID !== current.expectedContinuationMessageID) return;
      current.currentUserMessageID = parentID;
      current.currentUserCreatedAt = Date.now();
      current.waitingForContinuation = false;
    }
    if (current && current.currentUserMessageID && parentID && parentID !== current.currentUserMessageID) return;

    if (info.error && isRateLimitError(info.error)) {
      const userMessageID = parentID || current?.currentUserMessageID;
      if (!userMessageID) return;
      const latestUser = latestUserMessages.get(update.sessionId);
      if (latestUser && latestUser.id !== userMessageID) return;
      const state = current && (!current.currentUserMessageID || current.currentUserMessageID === userMessageID)
        ? current
        : createState(update.sessionId, directoryHint, info, userMessageID);
      state.directory = directoryHint || state.directory;
      state.currentUserMessageID = userMessageID;
      state.assistantMessageID = info.id;
      state.pendingError = info.error;
      clearRetryTimer(state);
      clearAcceptedTimer(state);
      state.waitingForContinuation = false;
      state.errorObservedAt = Date.now();
      state.working = false;
      states.set(update.sessionId, state);
      arm(state);
      return;
    }

    if (current && current.currentUserMessageID === parentID && (messageCompleted(info) || info.error)) {
      clearState(update.sessionId);
    }
  };

  const stop = () => {
    stopped = true;
    for (const sessionId of states.keys()) clearState(sessionId);
    for (const timer of latestUserMessageTimers.values()) clearTimeout(timer);
    states.clear();
    latestUserMessages.clear();
    latestUserMessageTimers.clear();
  };

  return { processPayload, stop };
};
