/**
 * Fallback CSS rules for `@pierre/diffs` in browsers that lack support for
 * modern CSS `light-dark()` (added in Chromium 123, Safari 17.5, Firefox 120).
 *
 * `@pierre/diffs` computes `--diffs-computed-diff-line-bg` via:
 * `light-dark(color-mix(in lab, ...), color-mix(in lab, ...))`
 * When `light-dark()` is unsupported by the browser (such as Chromium < 123
 * in enterprise / intranet environments), the declaration is dropped, leaving
 * addition and deletion rows without background highlighting.
 *
 * Injected into `@layer unsafe` so it takes priority over `@layer base`.
 */
export const DIFF_LINE_FALLBACK_CSS = `
  /* Fallback diff line styles for browsers without CSS light-dark() support */
  [data-line-type="change-addition"] {
    --diffs-line-bg: var(--diffs-bg-addition-override, rgba(118, 173, 79, 0.18));
    background-color: var(--diffs-line-bg) !important;
  }

  [data-line-type="change-deletion"] {
    --diffs-line-bg: var(--diffs-bg-deletion-override, rgba(218, 91, 74, 0.18));
    background-color: var(--diffs-line-bg) !important;
  }

  [data-column-number][data-line-type="change-addition"],
  [data-gutter-buffer][data-line-type="change-addition"] {
    background-color: var(--diffs-bg-addition-override, rgba(118, 173, 79, 0.18)) !important;
    color: var(--diffs-addition-color-override, #76ad4f) !important;
  }

  [data-column-number][data-line-type="change-deletion"],
  [data-gutter-buffer][data-line-type="change-deletion"] {
    background-color: var(--diffs-bg-deletion-override, rgba(218, 91, 74, 0.18)) !important;
    color: var(--diffs-deletion-color-override, #da5b4a) !important;
  }

  [data-line-type="change-addition"] [data-diff-span] {
    background-color: var(--diffs-bg-addition-emphasis-override, rgba(118, 173, 79, 0.35)) !important;
  }

  [data-line-type="change-deletion"] [data-diff-span] {
    background-color: var(--diffs-bg-deletion-emphasis-override, rgba(218, 91, 74, 0.35)) !important;
  }

  @media (pointer: fine) {
    [data-line-type="change-addition"]:where([data-hovered]) {
      background-color: var(--diffs-bg-addition-emphasis-override, rgba(118, 173, 79, 0.26)) !important;
    }

    [data-line-type="change-deletion"]:where([data-hovered]) {
      background-color: var(--diffs-bg-deletion-emphasis-override, rgba(218, 91, 74, 0.26)) !important;
    }
  }
`;
