import { describe, expect, test } from 'bun:test';
import { DIFF_LINE_FALLBACK_CSS } from './diffFallbackCss';

describe('DIFF_LINE_FALLBACK_CSS', () => {
  test('includes explicit fallback background colors for additions and deletions', () => {
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-line-type="change-addition"]');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-line-type="change-deletion"]');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('--diffs-bg-addition-override');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('--diffs-bg-deletion-override');
  });

  test('includes explicit fallback gutter column colors', () => {
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-column-number][data-line-type="change-addition"]');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-column-number][data-line-type="change-deletion"]');
  });

  test('includes explicit fallback intra-line word diff span colors', () => {
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-line-type="change-addition"] [data-diff-span]');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('[data-line-type="change-deletion"] [data-diff-span]');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('--diffs-bg-addition-emphasis-override');
    expect(DIFF_LINE_FALLBACK_CSS).toContain('--diffs-bg-deletion-emphasis-override');
  });
});
