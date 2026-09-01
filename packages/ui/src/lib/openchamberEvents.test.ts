import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('./runtime-url', () => ({
  getRuntimeUrlResolver: () => ({ sse: (path: string) => `http://runtime.test${path}` }),
}));

mock.module('./runtime-switch', () => ({
  getRuntimeApiBaseUrl: () => '',
  getRuntimeKey: () => 'local',
  subscribeRuntimeEndpointChanged: () => () => undefined,
}));

class MockEventSource {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('openchamber events', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    globalThis.window = {} as Window & typeof globalThis;
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  test('dispatches externally created session events', async () => {
    const { subscribeOpenchamberEvents } = await import('./openchamberEvents');
    const events: unknown[] = [];
    const listener = (event: unknown) => events.push(event);
    const unsubscribe = subscribeOpenchamberEvents(listener);
    const source = MockEventSource.instances[0];

    source.onmessage?.({
      data: JSON.stringify({
        type: 'openchamber:session-created',
        properties: {
          sessionId: 'ses_123',
          directory: '/repo/worktrees/research',
          projectId: 'project_1',
          createdAt: 123,
          promptDispatched: true,
          dispatchedAsCommand: false,
        },
      }),
    });

    expect(events).toEqual([
      {
        type: 'session-created',
        sessionId: 'ses_123',
        directory: '/repo/worktrees/research',
        projectId: 'project_1',
        createdAt: 123,
        promptDispatched: true,
        dispatchedAsCommand: false,
      },
    ]);
    unsubscribe();
  });

  test('dispatches taskboard invalidation events', async () => {
    const { subscribeOpenchamberEvents } = await import('./openchamberEvents');
    const events: unknown[] = [];
    const unsubscribe = subscribeOpenchamberEvents((event) => events.push(event));
    const source = MockEventSource.instances[0];

    source.onmessage?.({
      data: JSON.stringify({
        type: 'openchamber:taskboard-updated',
        properties: {
          projectId: 'project_1',
          taskId: 'task_1',
          kind: 'moved',
        },
      }),
    });

    expect(events).toEqual([
      { type: 'taskboard-updated', projectId: 'project_1', taskId: 'task_1', kind: 'moved' },
    ]);
    unsubscribe();
  });

  test('notifies listeners when the OpenChamber event stream reconnects', async () => {
    const { subscribeOpenchamberEvents } = await import('./openchamberEvents');
    const events: unknown[] = [];
    const unsubscribe = subscribeOpenchamberEvents((event) => events.push(event));
    const source = MockEventSource.instances[0];

    source.onmessage?.({ data: JSON.stringify({ type: 'openchamber:event-stream-ready', properties: {} }) });

    expect(events).toEqual([{ type: 'event-stream-ready' }]);
    unsubscribe();
  });
});
