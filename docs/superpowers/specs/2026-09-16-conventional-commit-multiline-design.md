# Conventional Commits Multi-line Support Design

## Overview
Currently, the Git commit message generator in OpenChamber parses only `subject` and `highlights` from model output, forcibly stripping out `body` and `footer`. Furthermore, the default Magic Prompt instructs models to return strictly `{"subject": string, "highlights": string[]}`. As a result, custom prompts aiming for standard Conventional Commits with a detailed body or footers (such as `BREAKING CHANGE: ...` or `Refs: #123`) fail to produce multi-line commit messages. In the UI, the commit textarea is populated only with the single-line subject, while highlights are diverted into a separate auxiliary box.

This design upgrades commit generation to a first-class multi-line Conventional Commit structure (`subject`, `body`, `footer`), while maintaining backward compatibility with legacy single-line responses.

## Architecture & Data Flow

1. **Protocol & Type Updates (`packages/ui/src/lib/api/types.ts`)**
   - Extend `GeneratedCommitMessage`:
     ```ts
     export interface GeneratedCommitMessage {
       subject: string;
       body?: string;
       footer?: string;
       highlights?: string[];
     }
     ```

2. **Parser & Formatter (`packages/ui/src/lib/gitApi.ts` & `gitApiHttp.ts`)**
   - Update `parseCommitStructured`:
     - Extract `subject`, `body`, and `footer` (trimmed strings, or undefined if empty).
     - Keep extracting `highlights` for backward compatibility.
   - Introduce a helper `formatFullCommitMessage(message: GeneratedCommitMessage): string`:
     - Assembles `[subject, body, footer].filter(Boolean).join('\n\n')`.
     - Preserves existing Gitmoji prefix logic on the `subject` header line without corrupting subsequent body paragraphs.

3. **Magic Prompt Template (`packages/ui/src/lib/magicPrompts.ts`)**
   - Update `git.commit.generate.visible` and `git.commit.generate.instructions`:
     - Instruct the model to generate full Conventional Commits when changes warrant detailed explanation.
     - Shape:
       ```json
       {
         "subject": string,
         "body": string | null,
         "footer": string | null,
         "highlights": string[]
       }
       ```
     - Explain when to produce `body` (e.g., non-trivial changes, motivation, context) and `footer` (e.g., breaking changes, issue references), and explicitly allow empty string / null for trivial changes.

4. **UI Integration (`GitView.tsx`, `MobileChangesSurface.tsx`, `CommitInput.tsx`)**
   - In `GitView.tsx` and `MobileChangesSurface.tsx`:
     - On successful generation, use `formatFullCommitMessage(message)` (with gitmoji prefix on the subject if enabled) to populate the commit textarea directly with the complete message.
   - In `CommitInput.tsx`:
     - Ensure the auto-resize behaviour smoothly handles multi-line content with appropriate max height and vertical scrolling.

5. **Testing**
   - Add unit tests for `parseCommitStructured` and `formatFullCommitMessage` in `packages/ui/src/lib/gitApi.test.ts` (or focused test file).
   - Verify that single-line legacy outputs without body/footer continue to work seamlessly.
