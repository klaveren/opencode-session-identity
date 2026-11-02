/**
 * SessionIdentity Plugin — opencode V2
 * ---------------------------------------------------------------------------
 * Exposes the current opencode session id (`ses_…`) to the agent through the
 * system prompt: one line appended to the model-visible context before every
 * agent model request. The agent is born knowing its session id — ready for
 * audit trails, telemetry and state-tracking integrations.
 *
 * WHAT CHANGED IN V2 (this is the v2 port of the v1 plugin):
 *   1. SHELL CHANNEL DROPPED — v2 opencode injects `OPENCODE_SESSION_ID` into
 *      every shell it spawns NATIVELY (the shell tool sets it on the
 *      `shell.create.before` env before spawn, alongside `AGENT`, `OPENCODE`
 *      and `AI_AGENT`). `printenv OPENCODE_SESSION_ID` works out of the box
 *      on opencode >= 2.x; no plugin needed. Verified on v2.2.5.
 *      Consequently the v1 options `shell` and `envVar` have no effect here:
 *      the v1 hook received `input.sessionID`, but the v2
 *      `shell.create.before` event carries only `{ command, cwd, timeout,
 *      shell, env }` — a custom env var cannot be populated per-session from
 *      a plugin anymore.
 *   2. PROMPT CHANNEL PORTED — v1's `experimental.chat.system.transform`
 *      becomes `ctx.session.hook("context", …)`; entries in `event.system`
 *      are `SystemPart` objects (`{ type: "text", text }`), not plain
 *      strings as in v1. The `context` hook runs immediately before each
 *      agent model request, guarded so a shape change can never break a turn.
 *
 * Register in opencode.json (V2 `plugins` key). Options via object form:
 *     "plugins": [
 *       { "package": "./plugin/session-identity", "options": { "prompt": false } }
 *     ]
 *
 * Pure JS, no static SDK type dependency beyond `@opencode/plugin` (peer).
 *
 * ---
 * Author:  Henrique Van Klaveren
 * Ported to V2 by: webboty (2026-11-02)
 * License: MIT — see LICENSE
 */

import { Plugin } from "@opencode/plugin"

const DEFAULTS = {
  /** Master switch. */
  enabled: true,
  /** Append the session id line to the system prompt on every model request. */
  prompt: true,
}

/** The system-prompt line. Kept short and factual — it is appended to every single turn. */
const promptLine = (sessionID) => `Session identity (opencode): your current sessionID is ${sessionID}.`

export default Plugin.define({
  id: "session-identity",
  async setup(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.options ?? {}) }
    if (!cfg.enabled) return

    if (!cfg.prompt) return

    // Guarded on its own: a shape change in the context hook must never break a turn.
    await ctx.session.hook("context", (event) => {
      try {
        if (event?.sessionID && Array.isArray(event.system)) {
          event.system.push({ type: "text", text: promptLine(event.sessionID) })
        }
      } catch {
        /* never break a turn over an identity hint */
      }
    })
  },
})
