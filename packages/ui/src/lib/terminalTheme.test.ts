import { describe, expect, test } from 'bun:test';

import { buildTerminalFontFamily } from '@/lib/terminalTheme';

describe('buildTerminalFontFamily', () => {
  test('keeps explicit fallback fonts ahead of generic monospace families', () => {
    const family = buildTerminalFontFamily(
      'ui-monospace, "SFMono-Regular", "Menlo", monospace',
    );

    expect(family.indexOf('ui-monospace')).toBe(-1);
    expect(family.indexOf('monospace')).toBe(family.lastIndexOf('monospace'));
    expect(family.indexOf('Liberation Mono')).toBeLessThan(family.indexOf('monospace'));
  });
});
