import { describe, expect, test } from 'bun:test';

import { shouldRenderSessionMetrics } from './sessionMetrics';

describe('session metrics visibility', () => {
  test('gates the complete Composer metrics row with one setting', () => {
    expect(shouldRenderSessionMetrics(true, 3)).toBe(true);
    expect(shouldRenderSessionMetrics(false, 3)).toBe(false);
    expect(shouldRenderSessionMetrics(true, 0)).toBe(false);
  });
});
