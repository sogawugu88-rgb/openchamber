# Goal rate-limit handling and code-server links

## Scope

This change contains two independent improvements:

1. Make the number of consecutive Goal progress-audit failures before blocking configurable.
2. Add an optional global code-server base URL and a session action that opens the current project there.

The existing default behavior remains unchanged: two consecutive unavailable or rate-limited audit calls block the Goal.

## Configuration

Add two persisted OpenChamber settings:

- `sessionGoalAuditFailureLimit`: integer from `1` through `20`, default `2`, preventing an unbounded unaudited loop.
- `codeServerBaseUrl`: optional normalized absolute `http` or `https` URL. Empty input clears the setting.

The server settings sanitizer is authoritative for values received over HTTP and from disk. Missing or invalid audit-limit values resolve to `2`; an invalid update is rejected without replacing the previous persisted value. An invalid code-server URL is rejected without replacing the previous value and never becomes an active link. The URL normalization removes trailing slashes while preserving a possible base path.

The shared Settings UI uses the existing settings primitives, persistence helpers, and i18n dictionaries. The audit-limit control belongs with Goal/OpenChamber behavior settings. The code-server field belongs in the same OpenChamber settings area because it applies globally to all projects. Both controls have searchable settings anchors and quiet save feedback.

## Goal runtime behavior

The session-goal runtime replaces its fixed audit-failure threshold with a dependency that reads the validated setting for the active server instance. A missing setting uses `2`.

On each failed or unavailable progress-audit call:

- Increment `auditFailStreak`.
- Continue unaudited while the streak is below the configured limit.
- Set the Goal to `blocked` with the existing `progress audit unavailable` reason when the streak reaches the limit.

A successful audit resets the streak as it does today. Other terminal conditions, including assistant turn errors, token budget exhaustion, and the maximum automatic continuation count, are unchanged. Changing the setting affects future ticks and does not rewrite existing Goal metadata.

Tests cover the default threshold, a custom threshold, invalid settings fallback, and the transition immediately before and at the configured limit.

## Code-server URL behavior

The session action uses the session record's authoritative `directory`. It must not use a guessed active directory or a containing store key. When both a valid configured base URL and a non-empty authoritative directory exist, it builds the link with URL APIs and a `folder` query parameter:

```
<base-url>?folder=<encoded-authoritative-directory>
```

Existing query parameters in the configured base URL are preserved. The folder value is encoded by `URLSearchParams`. No bearer token, pairing credential, password, or other secret is added to the URL.

The session header or project context area displays an icon-only external-open action when the link can be generated. The action uses the shared icon and button primitives, has a localized accessible label and tooltip, and opens the external URL through the existing runtime/browser-safe mechanism. It is hidden when the setting is empty, the session has no authoritative project directory, or the current runtime explicitly cannot open external URLs.

The feature is a link generator, not a connectivity check. It does not probe the code-server host and does not expose local paths through any OpenChamber API beyond the user-selected external navigation.

## Runtime parity and boundaries

The settings fields are OpenChamber-owned and use the existing settings runtime in web, Electron, hosted mobile, and Capacitor mobile. VS Code receives the same persisted settings contract, but the external-open action is hidden when its host runtime cannot provide the established external URL behavior.

The shared UI accesses OpenChamber settings through `RuntimeAPIs` or `runtimeFetch`, following existing settings persistence patterns. It does not hardcode an OpenChamber origin, localhost URL, port, or credentials.

## Error handling and compatibility

- Existing settings files without either field remain valid.
- A malformed audit limit cannot disable the blocking safety guard.
- A malformed or unsupported code-server URL produces no actionable link.
- A failed settings write preserves the existing setting and uses the normal settings save failure indicator.
- A session with a missing or untrusted directory produces no link rather than opening the configured host at an arbitrary location.

## Validation

Add focused server tests for settings sanitization, persistence round trips, Goal threshold behavior, and URL construction. Add shared UI tests for settings controls and link visibility/link encoding where existing component test precedent supports it. Run package-scoped tests, type-check, and lint for changed files. Because this changes a persisted settings contract and shared UI behavior, validate web and relevant runtime consumers; run `bun run dead-code` if exports or import shape change.

## Non-goals

- No per-project code-server URL overrides.
- No local-to-remote path mapping.
- No configurable audit retry delay or exponential backoff in this change.
- No automatic code-server health checks or authentication integration.
