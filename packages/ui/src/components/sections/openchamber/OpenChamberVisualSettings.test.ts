import { describe, expect, test } from 'bun:test';
import { shouldRenderCodeServerSetting } from './OpenChamberVisualSettings';

describe('OpenChamber visual settings visibility', () => {
  test('keeps code-server visible in an Appearance-only settings list', () => {
    expect(shouldRenderCodeServerSetting(['theme', 'fontSize', 'codeServer'])).toBe(true);
    expect(shouldRenderCodeServerSetting(['theme', 'fontSize'])).toBe(false);
  });
});
