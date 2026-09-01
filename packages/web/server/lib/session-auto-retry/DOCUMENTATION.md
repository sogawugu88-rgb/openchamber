# Session auto continuation

Server-side recovery for ordinary conversations that finish with a provider
rate-limit error after OpenCode exhausts its own retry schedule.

## Contract

- Only transient rate-limit errors are eligible. Permanent account and usage
  quota errors are left for the user to resolve.
- Recovery sends a new synthetic continuation message. It does not reuse the
  failed user message ID or replay persisted input parts.
- The continuation uses the latest failed turn's provider, model, agent, and
  variant.
- The backend setting controls the recovery-chain length as a non-negative
  integer; the default is five continuation messages and zero disables
  recovery.
- A user message, Revert, deletion, or explicit stop cancels the chain.
- Active Goal sessions are ignored because Goal Mode owns their continuation
  lifecycle.
- An ambiguous `prompt_async` result stops recovery rather than risking a
  duplicate model turn.

## Flow

1. The global OpenCode event hub delivers a completed assistant error.
2. The runtime accepts a rate-limit error, reads current settings, and skips
   active Goal sessions.
3. After `Retry-After` or exponential backoff, it verifies that the failed
   prompt is still the session tail.
4. It sends a new `prompt_async` request with a generated message ID and one
   `synthetic` text part containing the configured continuation prompt.
5. A later rate-limit failure starts the next step in the same bounded chain.

The runtime belongs to the OpenChamber web server, so the browser does not need
to remain open. The in-memory recovery chain ends if the server restarts.
