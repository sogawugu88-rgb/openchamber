import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';

const originalWindow = globalThis.window;
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });

const { createVSCodeAPIs } = await import('./index');
const runtimeAPIs: RuntimeAPIs = createVSCodeAPIs();

describe('VS Code token usage API', () => {
  test('reports explicit unsupported behavior when no local server route exists', async () => {
    await assert.rejects(runtimeAPIs.tokenUsage.getReport('2026-08'), {
      message: 'Token usage is not supported in the VS Code runtime',
    });
  });
});

Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
