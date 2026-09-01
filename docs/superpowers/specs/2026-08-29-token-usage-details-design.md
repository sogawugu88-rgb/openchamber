# Token usage details design

## Scope

Extend the existing OpenChamber token usage report and UI so users can inspect
recent daily usage and model-level usage without putting long numbers inside
calendar cells. Add a persisted Appearance setting that controls only the
session token metrics row below the chat composer.

## Decisions

- The existing token usage report remains the only data request. It accepts an
  optional client IANA timezone and returns daily model aggregates along with
  the existing totals.
- The server owns session/message traversal, de-duplication, timezone bucketing,
  and provider/model aggregation. The UI does not recalculate global usage from
  the current session.
- The client sends its browser timezone. Requests without a timezone retain the
  server-timezone fallback for compatibility.
- The token details setting defaults to enabled and is persisted through the
  existing UI settings persistence path. It hides only the Composer metrics row.
  The context panel, Usage page, recent-days table, and model details remain
  unaffected.

## Report contract

`TokenUsageReport` gains a daily model map keyed by date. Each date contains
provider/model entries with stable provider and model identifiers plus the
input, output, reasoning, cache-read, cache-write, and total token counts.
Existing `today`, `currentMonth`, `total`, and `days` fields retain their
meaning, but date classification uses the requested timezone.

The server rejects invalid IANA timezones and malformed model metadata. Fetch
failure remains distinct from a successful empty report. Duplicate assistant
samples continue to count once by session, message, and step identity.

## UI behavior

The calendar keeps its seven-column month layout and intensity scale, but cells
show only the day number and color intensity. A recent-days table below the
calendar shows the latest 14 dates with usage, relative intensity, and a color
bar. Dates with no usage are omitted from the table.

Selecting a date expands its model breakdown below the table. The breakdown is
grouped by provider and model and shows total, input, output, reasoning, and
cache values. Selecting another date replaces the breakdown; selecting the
same date collapses it. Empty dates do not create an empty detail panel.

The existing calendar remains collapsed in the context panel and requests data
only after expansion. The full Usage settings page continues loading its report
on mount. Both surfaces use the same report and display components.

## Settings and localization

Add a localized Appearance checkbox for showing session token details. Add all
new calendar/table/model-detail labels to every supported locale dictionary.
Use shared Settings primitives, theme tokens, and sprite icons. No visible
user-facing text is hardcoded in components.

## Validation

- Unit tests cover client timezone forwarding, server timezone selection,
  invalid timezone rejection, daily model aggregation, recent-day selection,
  and duplicate sample handling.
- Component tests cover the token-detail setting and calendar/table selection
  behavior.
- Run focused UI and Web tests, package type checks, changed-file Oxlint,
  production Web build, and the existing dead-code report for the new module.
- Verify PM2 serves the rebuilt bundle and the authenticated UI can request the
  token usage route.
