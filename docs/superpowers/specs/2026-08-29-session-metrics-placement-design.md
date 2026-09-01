# Session metrics placement design

## Scope

Move the live session metrics row out of the rounded Composer surface and place
it directly below the Composer on desktop and on the expanded mobile Composer.
The collapsed mobile pill keeps its current behavior and does not show the row.

## Decisions

- Extract the metrics markup from `ComposerFooter` into a focused
  `SessionMetricsBar` component.
- Render `SessionMetricsBar` after the shared pill/full Composer wrapper in
  `ChatInput`, so it is outside both the bordered Composer and its dictation
  overlay, using the existing `chat-input-column` alignment.
- Keep `ComposerFooter` responsible only for Composer controls and keep those
  controls inside the rounded surface.
- Reuse the existing `SessionMetrics`, `showSessionTokenDetails` setting,
  localized labels, compact number formatting, and tooltip behavior. Display
  only total tokens, input, output, reasoning, cache, LLM duration, TTFT, cache
  hit rate, and output speed. Omit model name, turn count, step count, and tool
  duration from this compact row.
- Do not change the server report, session metric derivation, persistence, or
  the mobile collapsed-pill branch.

## Layout behavior

The bordered Composer remains the flex item that grows in expanded mode. The
metrics bar follows the full Composer wrapper in normal document flow, so it
stays below the border without using negative margins, absolute positioning, or
a portal. The bar uses the same centered column and responsive padding as the
Composer, centers its metric items, and can wrap long metric sets on narrow
screens. Keeping it outside the wrapper-level dictation overlay prevents the
overlay from covering the bar.

The row is rendered only when the existing setting is enabled and at least one
metric exists. It remains hidden for the collapsed mobile pill because that
branch does not mount the full Composer controls.

## Testing

- Preserve the existing pure session-metric and visibility tests.
- Add a `SessionMetricsBar` component test using the existing happy-dom pattern
  to verify its visibility gate and rendered metric content. Verify the final
  sibling placement and the collapsed mobile-pill behavior with the desktop and
  mobile browser checks, because the Composer package does not mount the full
  `ChatInput` in its unit-test harness.
- Run focused UI tests, the UI package type check, changed-file Oxlint, and a
  browser/manual layout check at desktop and mobile widths. Rendering and
  keyboard behavior are not covered by the Composer package's unit tests.
