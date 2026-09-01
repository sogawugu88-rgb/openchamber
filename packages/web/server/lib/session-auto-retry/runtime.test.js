import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionAutoRetryRuntime } from './runtime.js';

const SESSION_ID = 'ses_retry';
const DIRECTORY = '/workspace';
const USER_ID = 'msg_user';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const requestPath = (input) => new URL(input?.url ?? input).pathname;

const settings = {
  sessionAutoContinueEnabled: true,
  sessionAutoContinueMaxRetries: 5,
  sessionAutoContinuePrompt: 'Continue the previous task from the current workspace state.',
};

const userMessage = (id = USER_ID) => ({
  info: {
    id,
    sessionID: SESSION_ID,
    role: 'user',
    agent: 'build',
    model: { providerID: 'provider', modelID: 'model', variant: 'fast' },
    time: { created: 1 },
  },
  parts: [{ id: `prt_${id}`, type: 'text', text: 'Finish the task.' }],
});

const rateLimitError = (overrides = {}) => ({
  name: 'APIError',
  data: {
    message: 'Too Many Requests',
    statusCode: 429,
    isRetryable: true,
    responseHeaders: { 'retry-after-ms': '1' },
    ...overrides,
  },
});

const failedAssistantMessage = (id, parentID, error = rateLimitError()) => ({
  info: {
    id,
    sessionID: SESSION_ID,
    parentID,
    role: 'assistant',
    providerID: 'provider',
    modelID: 'model',
    agent: 'build',
    variant: 'fast',
    time: { created: 2, completed: 3 },
    error,
  },
  parts: [],
});

const errorEvent = (assistantID, parentID, error = rateLimitError()) => ({
  type: 'message.updated',
  properties: { info: failedAssistantMessage(assistantID, parentID, error).info },
});

const abortedEvent = (assistantID = 'msg_aborted', parentID = USER_ID) => errorEvent(assistantID, parentID, {
  name: 'MessageAbortedError',
  data: { message: 'Aborted' },
});

const userEvent = (id) => ({
  type: 'message.updated',
  properties: { info: { ...userMessage(id).info, time: { created: Date.now() + 1 } } },
});

const idleEvent = () => ({
  type: 'session.status',
  properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
});

const createRuntime = (fetchImpl, options = {}) => createSessionAutoRetryRuntime({
  buildOpenCodeUrl: (pathname) => `http://opencode.test${pathname}`,
  getOpenCodeAuthHeaders: () => ({}),
  fetchImpl,
  readSettings: async () => settings,
  retryDelayMs: 1,
  ...options,
});

describe('session auto continuation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a new synthetic continuation with the configured message', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      requests.push({ pathname, method: init.method ?? 'GET', body: init.body });
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse([
        userMessage(),
        failedAssistantMessage('msg_failed', USER_ID),
      ]);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(idleEvent());
    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(1);

    const prompt = requests.find((request) => request.pathname === `/session/${SESSION_ID}/prompt_async`);
    expect(prompt).toBeDefined();
    const body = JSON.parse(prompt.body);
    expect(body.messageID).toMatch(/^msg_/);
    expect(body.messageID).not.toBe(USER_ID);
    expect(body.parts).toEqual([{
      type: 'text',
      text: settings.sessionAutoContinuePrompt,
      synthetic: true,
    }]);
    runtime.stop();
  });

  it('continues the same recovery chain with new message IDs and stops at five', async () => {
    const prompts = [];
    let messages = [userMessage(), failedAssistantMessage('msg_failed_0', USER_ID)];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse(messages);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) {
        prompts.push(JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);
    let parentID = USER_ID;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const assistantID = `msg_failed_${attempt}`;
      messages = [userMessage(parentID), failedAssistantMessage(assistantID, parentID)];
      runtime.processPayload(errorEvent(assistantID, parentID));
      const promptCountBefore = prompts.length;
      await vi.advanceTimersByTimeAsync(1);
      const continuation = prompts.at(-1);
      if (prompts.length > promptCountBefore) {
        expect(continuation.messageID).not.toBe(parentID);
        parentID = continuation.messageID;
        runtime.processPayload(userEvent(parentID));
      }
    }

    expect(prompts).toHaveLength(5);
    expect(new Set(prompts.map((prompt) => prompt.messageID)).size).toBe(5);
    runtime.stop();
  });

  it('honors a configured recovery count above the default', async () => {
    const prompts = [];
    let messages = [userMessage(), failedAssistantMessage('msg_failed_0', USER_ID)];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse(messages);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) {
        prompts.push(JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl, {
      readSettings: async () => ({ ...settings, sessionAutoContinueMaxRetries: 6 }),
    });
    let parentID = USER_ID;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const assistantID = `msg_failed_above_default_${attempt}`;
      messages = [userMessage(parentID), failedAssistantMessage(assistantID, parentID)];
      const promptCountBefore = prompts.length;
      runtime.processPayload(errorEvent(assistantID, parentID));
      await vi.advanceTimersByTimeAsync(1);
      if (prompts.length > promptCountBefore) {
        parentID = prompts.at(-1).messageID;
        runtime.processPayload(userEvent(parentID));
      }
    }

    expect(prompts).toHaveLength(6);
    runtime.stop();
  });

  it('recognizes a continuation error when its user event was missed', async () => {
    const prompts = [];
    let messages = [userMessage(), failedAssistantMessage('msg_failed_0', USER_ID)];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse(messages);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) {
        prompts.push(JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed_0', USER_ID));
    await vi.advanceTimersByTimeAsync(1);
    const firstContinuation = prompts[0];
    messages = [userMessage(firstContinuation.messageID), failedAssistantMessage('msg_failed_1', firstContinuation.messageID)];
    runtime.processPayload(errorEvent('msg_failed_1', firstContinuation.messageID));
    await vi.advanceTimersByTimeAsync(1);

    expect(prompts).toHaveLength(2);
    runtime.stop();
  });

  it('uses fresh settings for later continuation messages and honors a lower limit', async () => {
    const currentSettings = { ...settings, sessionAutoContinueMaxRetries: 2 };
    const prompts = [];
    let messages = [userMessage(), failedAssistantMessage('msg_failed_0', USER_ID)];
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse(messages);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) {
        prompts.push(JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl, { readSettings: async () => currentSettings });

    runtime.processPayload(errorEvent('msg_failed_0', USER_ID));
    await vi.advanceTimersByTimeAsync(1);
    const firstContinuation = prompts[0];
    currentSettings.sessionAutoContinuePrompt = 'Use the updated continuation instructions.';
    runtime.processPayload(userEvent(firstContinuation.messageID));
    messages = [userMessage(firstContinuation.messageID), failedAssistantMessage('msg_failed_1', firstContinuation.messageID)];
    runtime.processPayload(errorEvent('msg_failed_1', firstContinuation.messageID));
    await vi.advanceTimersByTimeAsync(1);

    expect(prompts).toHaveLength(2);
    expect(prompts[1].parts[0].text).toBe(currentSettings.sessionAutoContinuePrompt);
    runtime.processPayload(userEvent(prompts[1].messageID));
    runtime.processPayload(errorEvent('msg_failed_2', prompts[1].messageID));
    await vi.advanceTimersByTimeAsync(1);
    expect(prompts).toHaveLength(2);
    runtime.stop();
  });

  it('does not send continuation messages when the backend setting is disabled', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Disabled continuation should not fetch');
    });
    const runtime = createRuntime(fetchImpl, {
      readSettings: async () => ({ ...settings, sessionAutoContinueEnabled: false }),
    });

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('stops when settings cannot be read', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Settings failure should stop recovery before OpenCode fetches');
    });
    const runtime = createRuntime(fetchImpl, {
      readSettings: async () => {
        throw new Error('settings unavailable');
      },
    });

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('skips active Goal sessions', async () => {
    const fetchImpl = vi.fn(async (input) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) {
        return jsonResponse({
          id: SESSION_ID,
          metadata: { openchamber: { goal: { id: 'goal_1', status: 'active' } } },
        });
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it('cancels a pending continuation when the user sends a newer message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Canceled continuation should not fetch');
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    runtime.processPayload(userEvent('msg_new_user'));
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('cancels a pending continuation when the user aborts the session', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Aborted continuation should not fetch');
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    runtime.processPayload(idleEvent());
    runtime.processPayload(abortedEvent());
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('cancels a pending continuation when the session is deleted', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Deleted session should not fetch');
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    runtime.processPayload({
      type: 'session.deleted',
      properties: { sessionID: SESSION_ID },
    });
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('does not replay a reverted session from the authoritative session record', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (input) => {
      const pathname = requestPath(input);
      requests.push(pathname);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({
        id: SESSION_ID,
        revert: { messageID: USER_ID },
        metadata: {},
      });
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(1);

    expect(requests).toEqual([`/session/${SESSION_ID}`]);
    runtime.stop();
  });

  it('does not send when the latest assistant error is missing from the tail', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (input) => {
      const pathname = requestPath(input);
      requests.push(pathname);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse([userMessage()]);
      throw new Error(`Unexpected request: ${pathname}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(1);

    expect(requests).not.toContain(`/session/${SESSION_ID}/prompt_async`);
    runtime.stop();
  });

  it('keeps an ambiguous continuation failure from starting a second chain', async () => {
    let promptCalls = 0;
    const fetchImpl = vi.fn(async (input, init = {}) => {
      const pathname = requestPath(input);
      if (pathname === `/session/${SESSION_ID}`) return jsonResponse({ id: SESSION_ID, metadata: {} });
      if (pathname === '/session/status') return jsonResponse({});
      if (pathname === `/session/${SESSION_ID}/message`) return jsonResponse([userMessage(), failedAssistantMessage('msg_failed', USER_ID)]);
      if (pathname === `/session/${SESSION_ID}/prompt_async`) {
        promptCalls += 1;
        throw new Error('connection lost after dispatch');
      }
      throw new Error(`Unexpected request: ${pathname} ${init.method ?? 'GET'}`);
    });
    const runtime = createRuntime(fetchImpl);

    runtime.processPayload(errorEvent('msg_failed', USER_ID));
    await vi.advanceTimersByTimeAsync(1);
    const promptRequest = fetchImpl.mock.calls.find(([input]) => requestPath(input) === `/session/${SESSION_ID}/prompt_async`);
    const continuationID = JSON.parse(promptRequest[1].body).messageID;
    runtime.processPayload(userEvent(continuationID));
    runtime.processPayload(errorEvent('msg_late_error', continuationID));
    await vi.advanceTimersByTimeAsync(10);

    expect(promptCalls).toBe(1);
    runtime.stop();
  });

  it('does not continue permanent quota errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Permanent quota error should not fetch');
    });
    const runtime = createRuntime(fetchImpl);
    const quotaError = rateLimitError({
      message: 'Usage limit reached',
      responseBody: 'FreeUsageLimitError',
    });

    runtime.processPayload(errorEvent('msg_quota', USER_ID, quotaError));
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchImpl).not.toHaveBeenCalled();
    runtime.stop();
  });
});
