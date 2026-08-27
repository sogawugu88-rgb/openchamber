# OpenCode token usage and chat metrics

## Goal

Add OpenCode-backed token accounting to the forked OpenChamber application.
The Usage surface will show today's total, the current month's total, the
all-time total, and a per-day calendar. The chat composer footer will show a
current-session summary, including output speed in tokens per second.

The feature reads data already returned by OpenCode. It does not call
DeepSeek Harness or any other external usage service and does not add provider
credentials.

## Decisions

- The OpenCode server is the authority for event data and timezone.
- A calendar day is derived using the server process timezone, not the
  browser timezone.
- Historical totals include all sessions and all models visible to the
  connected OpenCode runtime.
- Token total is the sum of input, output, cache-read, and cache-write tokens.
  Missing components contribute zero. A usage sample is counted once.
- The Usage page owns historical aggregation. The chat composer owns the
  current-session summary.
- Per-message metric rows are out of scope. The summary appears only below
  the composer.
- A metric is omitted when its source data is unavailable. Missing data is
  not rendered as authoritative zero.

## Architecture

### Server aggregation

Add a focused OpenChamber route and service under the web server's OpenCode
integration. The route will accept a month selector and return a parsed,
trusted contract containing:

- server timezone identifier or offset information;
- the selected month;
- today's total, when today is in the selected runtime month;
- current-month total;
- all-time total;
- daily totals keyed by server-local calendar date;
- a fetched-at timestamp.

The service will obtain complete session coverage from the OpenCode API and
read assistant message usage records. It will aggregate in one server-side
pass, keyed by server-local date. It will preserve the distinction between a
successful empty result and a failed fetch. It will not expose prompt text,
credentials, or raw event payloads.

The route must be registered before the generic OpenCode proxy. Shared UI
code will consume it through the existing runtime API/fetch boundary. The
runtime contract will define behavior for web, Electron, VS Code, hosted
mobile, and Capacitor mobile. Runtimes that cannot provide the route will
return an explicit unsupported result rather than an empty successful report.

### Current-session metrics

Use the existing session message/event projections for the composer footer.
The shared derivation will aggregate only the selected session and will be
updated by the authoritative session stream and message reconciliation path.
It will expose only values with sufficient evidence:

- turn and step counts;
- total, input, output, cache-read, and cache-write tokens;
- total LLM duration and tool duration;
- average time to first token;
- output tokens divided by measured decoding duration as `tokens/s`;
- cache hit rate when input and cache-read data exist.

The derivation will preserve stable references for unchanged metric groups and
will avoid scanning unrelated sessions on a streaming event. A missing timing
boundary excludes that step from the affected average rather than inventing a
duration.

## UI

The existing Usage page will add a token summary area using its current
layout, semantic theme tokens, and shared primitives. It will show:

- Today
- This month
- Total
- a month navigator;
- a seven-column calendar with one cell per day;
- a visual intensity scale based on that month's daily totals.

The calendar will use server-local date keys directly. Empty days remain
visible and have no usage intensity. Loading, successful empty data, and
request failure are separate states. A failed reload preserves the previous
successful report and offers retry.

The composer footer will add the current-session metric groups to the existing
compact stats line. It will use the existing chat layout and localization
system, remain below the input area, and omit unsupported values. It must fit
on narrow screens through the existing truncation/tooltip behavior without
covering composer controls.

All new visible strings, labels, tooltips, and accessibility names will be
added to every supported locale dictionary. Colors will use semantic theme
tokens, and any new controls will use the shared button/icon primitives.

## State and lifecycle

- Historical usage is keyed by runtime identity and selected month.
- Switching runtimes clears or isolates the prior runtime report and rejects
  stale requests.
- A server fetch failure preserves the last good report and does not replace
  it with an empty calendar.
- A successful empty report is valid and renders zero totals with empty days.
- A session switch resets current-session metrics to the new session's
  authoritative state.
- New settled assistant usage invalidates the affected historical day and the
  current month summary. Refresh work is coalesced rather than started once
  per event.
- No persistent schema migration is required because the feature derives
  data from OpenCode history and stores no new usage records.

## Testing

Server tests will cover:

- server-timezone date boundaries, including a UTC date crossing local
  midnight;
- today's, monthly, all-time, and per-day totals;
- multiple sessions and models;
- cache token components and duplicate sample protection;
- empty successful history;
- malformed or missing usage fields;
- OpenCode fetch failure and route error responses.

Shared UI tests will cover:

- metric arithmetic and `tokens/s` calculation;
- incomplete timing and usage samples;
- repeated and unrelated stream events;
- runtime/session switching and stale completion rejection;
- historical report loading, month navigation, empty data, failure, and
  retry;
- calendar date and intensity mapping.

Validation will include focused tests, package type checks, Oxlint on changed
TypeScript/JavaScript files, the affected build, and `bun run dead-code` when
new files or exports require it. The final release check will include
`npm pack --dry-run`, package-name availability, and a publish verification.

## Delivery

After implementation and verification:

1. Create a new unique npm package name derived from the fork identity, after
   checking the npm registry. Do not publish under the upstream package name
   or overwrite an existing package.
2. Update the package metadata and release scripts only as required by the
   repository's existing package layout.
3. Push the implementation and tests to
   `https://github.com/sogawugu88-rgb/openchamber`.
4. Publish the selected package using the npm login already present on this
   server.
5. Verify the published package metadata and version from the npm registry.

Publishing is conditional on all checks passing and npm authentication being
available. Secrets and authentication tokens must not be written to the
repository or logs.
