# Code-server project links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure one code-server base URL and open the current session's authoritative project directory with a `folder` query parameter.

**Architecture:** The server validates and persists the optional external base URL. Shared UI state hydrates that value, constructs the final URL locally with the standard URL API, and delegates opening to `openExternalUrl`. The Header owns the session action because it already resolves the authoritative session directory and project/worktree context.

**Tech Stack:** Node.js ESM settings runtime, React, Zustand, shared URL and settings helpers, Remix icon sprite through `Icon`, Vitest/Bun tests, i18n.

## Global Constraints

- `codeServerBaseUrl` is an optional absolute `http` or `https` URL.
- Empty input clears the setting.
- Invalid updates are rejected without replacing the previous value.
- The link uses the authoritative session `directory`, never a guessed active directory.
- The `folder` value is encoded with URL APIs; existing query parameters are preserved.
- No bearer token, pairing credential, password, or other secret is added to the URL.
- The action is hidden when the setting or authoritative directory is unavailable.
- Do not add dependencies.

---

### Task 1: Add and validate the code-server setting

**Files:**
- Modify: `packages/web/server/lib/opencode/settings-helpers.js` near existing URL/string settings.
- Modify: `packages/web/server/lib/opencode/settings-helpers.test.js` with URL validation cases.
- Modify: `packages/ui/src/lib/desktop.ts` in `DesktopSettings`.
- Modify: `packages/ui/src/stores/useUIStore.ts` in the state interface, default, setter, and persisted fields.
- Modify: `packages/ui/src/lib/persistence.ts` in authoritative materialization and hydration.
- Test: `packages/ui/src/lib/persistence.test.ts` for settings round-trip behavior.

**Interfaces:**
- Produces `codeServerBaseUrl?: string` in sanitized/formatted server settings.
- Produces `DesktopSettings.codeServerBaseUrl?: string` and a UI value of `string | null` or the existing equivalent optional-string state.
- The normalized value has no trailing slash and is limited to absolute `http`/`https` URLs.

- [ ] **Step 1: Write failing sanitizer tests.** Assert that `https://code.example.com/` becomes `https://code.example.com`, `https://code.example.com/code/` preserves `/code`, and existing query parameters remain. Assert empty input clears the setting according to existing empty-string conventions. Assert relative URLs, `javascript:` URLs, non-http protocols, whitespace-only values, and malformed URLs are rejected.

- [ ] **Step 2: Run the focused settings test.**

Run: `bun test packages/web/server/lib/opencode/settings-helpers.test.js`

Expected: the new URL assertions fail because the field is not yet recognized.

- [ ] **Step 3: Implement narrow URL normalization.** Parse with the standard `URL` constructor, accept only `http:` and `https:`, remove trailing pathname slashes without removing a meaningful base path, and return a normalized string. Add the field to sanitization and formatted responses without changing unrelated URL handling.

- [ ] **Step 4: Add shared state and persistence.** Add the optional field to `DesktopSettings`, initialize the UI value to empty, hydrate only a validated non-empty string returned by the server, add a setter, and include the field in the existing `updateDesktopSettings` serialization path. Preserve the old empty/default state when the field is absent.

- [ ] **Step 5: Run the settings tests.**

Run: `bun test packages/web/server/lib/opencode/settings-helpers.test.js packages/ui/src/lib/persistence.test.ts`

Expected: PASS for valid, empty, invalid, absent, and round-trip values.

### Task 2: Add the code-server URL builder

**Files:**
- Create: `packages/ui/src/lib/codeServerUrl.ts` for pure URL construction and narrow input validation.
- Test: `packages/ui/src/lib/codeServerUrl.test.ts`.

**Interfaces:**
- Produces `buildCodeServerProjectUrl(baseUrl: string | undefined, directory: string | undefined): string | null`.
- Returns `null` for missing/invalid base URL or missing/empty directory.

- [ ] **Step 1: Write failing pure-function tests.** Cover a plain base URL, a base URL with a path, a base URL with an existing query parameter, spaces and Unicode in the directory, trailing-slash normalization, invalid protocols, empty directory, and replacement of an existing `folder` parameter.

- [ ] **Step 2: Run the new test.**

Run: `bun test packages/ui/src/lib/codeServerUrl.test.ts`

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement the builder.** Parse the base with `URL`, require `http:` or `https:`, trim the directory, set `folder` through `url.searchParams.set('folder', directory)`, and return `url.toString()`. Do not concatenate query strings or append auth data.

- [ ] **Step 4: Run the builder test and lint it.**

Run: `bun test packages/ui/src/lib/codeServerUrl.test.ts`

Run: `bunx oxlint packages/ui/src/lib/codeServerUrl.ts packages/ui/src/lib/codeServerUrl.test.ts`

Expected: PASS with no new lint findings.

### Task 3: Add the settings UI and search entry

**Files:**
- Modify: `packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx` near the existing Goal/OpenChamber behavior sections, or the nearest existing OpenChamber settings section if layout conditions require it.
- Modify: `packages/ui/src/lib/settings/search.ts`.
- Modify: `packages/ui/src/lib/i18n/messages/en.settings.ts`.
- Modify: every non-English `packages/ui/src/lib/i18n/messages/*.settings.ts` dictionary.

**Interfaces:**
- Reads `codeServerBaseUrl` from the UI settings store.
- Writes with `updateDesktopSettings({ codeServerBaseUrl })` and the store setter.
- Uses `SettingsFieldRow`, standard text input sizing, `SettingsInfoHint`, and the normal save indicator.

- [ ] **Step 1: Add translated strings.** Add label, placeholder, info, and aria keys for the code-server base URL. Explain the expected `https://...` form and that the current project path is appended automatically. Add real translations to every locale file.

- [ ] **Step 2: Register the search item.** Add a searchable `code-server` settings item with localized title/description and matching `data-settings-item` anchor.

- [ ] **Step 3: Add the controlled input.** Render the field with the existing settings primitives, keep local text responsive while editing, and persist on the established field commit/change pattern. On a failed update, retain the previous authoritative value and show normal save failure feedback. Do not add a success toast.

- [ ] **Step 4: Run UI checks.**

Run: `bun test packages/ui/src/lib/persistence.test.ts packages/ui/src/lib/codeServerUrl.test.ts`

Run: `bunx oxlint packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx packages/ui/src/lib/persistence.ts packages/ui/src/lib/desktop.ts packages/ui/src/stores/useUIStore.ts`

Expected: PASS, with all new visible strings localized.

### Task 4: Add the session Header action

**Files:**
- Modify: `packages/ui/src/components/layout/Header.tsx` near the existing project/worktree context controls.
- Test: add `packages/ui/src/components/layout/Header.codeServer.test.tsx` using the existing project test setup.
- Modify: `packages/ui/src/lib/i18n/messages/en.ts` and every non-English base locale dictionary for the action label/tooltip.

**Interfaces:**
- Consumes `buildCodeServerProjectUrl`, `openExternalUrl`, the hydrated `codeServerBaseUrl`, and the current session's authoritative `directory`.
- Produces an icon-only Button action with a localized tooltip and accessible label.

- [ ] **Step 1: Write failing visibility/opening tests.** In `Header.codeServer.test.tsx`, verify the action is absent without a configured base URL, absent without `currentSession.directory`, and calls `openExternalUrl` with the encoded URL when both are present. Verify a containing project-store directory cannot override the session's own directory.

- [ ] **Step 2: Implement the action.** Read `currentSession?.directory` directly as the authoritative source, build the URL with the pure helper, and call `void openExternalUrl(url)` from a shared `Button` with `Icon name="external-link"`. Keep the action stable and avoid `window.open` or custom runtime checks in the component.

- [ ] **Step 3: Add the action translations.** Add the localized action label and tooltip to `packages/ui/src/lib/i18n/messages/en.ts` and every non-English base locale dictionary, reusing the existing external-open wording where it matches the meaning.

- [ ] **Step 4: Run focused component and URL tests.**

Run: `bun test packages/ui/src/lib/codeServerUrl.test.ts packages/ui/src/components/layout/Header.codeServer.test.tsx`

Expected: PASS for visibility, encoding, and external-open delegation.

### Task 5: Document and verify runtime behavior

**Files:**
- Modify: `packages/web/server/lib/opencode/DOCUMENTATION.md` in settings storage and exports.
- Modify: `packages/ui/src/sync/DOCUMENTATION.md` only if the final Header implementation changes directory authority or runtime switching behavior.

- [ ] **Step 1: Document the persisted field and authority.** State that `codeServerBaseUrl` is optional, validated to `http`/`https`, and used with the authoritative session directory as `folder`.

- [ ] **Step 2: Run affected package tests.**

Run: `bun run --cwd packages/web test`

Run: `bun run --cwd packages/ui test`

- [ ] **Step 3: Run shared checks.**

Run: `bun run type-check`

Run: `bun run dead-code`

Expected: type checks pass; inspect dead-code output and separate pre-existing findings from this feature.

- [ ] **Step 4: Verify runtime parity.** Check web, Electron, hosted mobile, Capacitor mobile, and VS Code behavior. The setting remains readable in every applicable runtime; VS Code hides the action only if its established external-open capability is unavailable.
