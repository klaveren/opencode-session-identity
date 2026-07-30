/**
 * SessionIdentity Plugin — opencode
 * ---------------------------------------------------------------------------
 * Exposes the current opencode session id (`ses_…`) to the agent, through two
 * complementary channels:
 *
 *   1. SHELL  (`shell.env` hook)                       → `OPENCODE_SESSION_ID` in every
 *                                                        shell invocation. Reactive: the agent
 *                                                        runs `printenv OPENCODE_SESSION_ID`.
 *   2. PROMPT (`experimental.chat.system.transform`)   → one line appended to the system prompt.
 *                                                        Proactive: the agent is born knowing it.
 *
 * THE PROBLEM: opencode does not inject the current session id into the environment. The
 * runtime only sets `OPENCODE` and `OPENCODE_PID`, so an agent has no way to learn its own
 * `ses_…` — which any audit trail, telemetry or state-tracking integration needs in order to
 * attribute an action to the session that performed it.
 *
 * WHY BOTH CHANNELS: they fail differently, and the redundancy is the point.
 *   · `shell.env` is a STABLE hook, but only fires when a shell actually runs.
 *   · `experimental.chat.system.transform` puts the id in context with zero effort from the
 *     agent — but it is an EXPERIMENTAL hook that may change or disappear in an opencode update.
 * Each channel is independently toggleable (`shell` / `prompt` options) and internally guarded,
 * so if the experimental one breaks the stable one keeps working.
 *
 * HOOK CONTRACTS (source @opencode-ai/plugin):
 *     "shell.env": (
 *         input:  { cwd: string; sessionID?: string; callID?: string },
 *         output: { env: Record<string, string> },
 *     ) => Promise<void>
 *
 *     "experimental.chat.system.transform": (
 *         input:  { sessionID?: string; model: Model },
 *         output: { system: string[] },
 *     ) => Promise<void>
 *
 * `sessionID` is optional in both — shells outside a session context (a plain user terminal)
 * simply do not carry one, hence the guards.
 *
 * Register EXPLICITLY in opencode.json using the tuple form if you want to pass options; a bare
 * string works too and uses the defaults:
 *     "plugin": [["./.opencode/custom/plugin/session-identity/session-identity.js", { "prompt": false }]]
 *
 * Pure JS, no static imports: `.opencode/package.json` is gitignored, so the plugin must not
 * depend on node_modules. That keeps it working on any machine or clone.
 *
 * ---
 * Author:  Henrique Van Klaveren
 * License: MIT — see LICENSE
 */

const DEFAULTS = {
  /** Master switch. */
  enabled: true,
  /** Channel 1: expose the id as an environment variable in every shell invocation. */
  shell: true,
  /** Channel 2: append the id to the system prompt. Uses an EXPERIMENTAL hook. */
  prompt: true,
  /** Environment variable name for the shell channel. */
  envVar: 'OPENCODE_SESSION_ID',
}

/** The system-prompt line. Kept short and factual — it is prepended to every single turn. */
const promptLine = (sessionID) => `Session identity (opencode): your current sessionID is ${sessionID}.`

export const SessionIdentityPlugin = async (_ctx, options) => {
  const cfg = { ...DEFAULTS, ...(options ?? {}) }
  if (!cfg.enabled) return {}

  const hooks = {}

  if (cfg.shell) {
    hooks['shell.env'] = async (input, output) => {
      if (input?.sessionID && output?.env) output.env[cfg.envVar] = input.sessionID
    }
  }

  if (cfg.prompt) {
    // Guarded on its own: this hook is experimental, and a shape change here must never
    // take the stable `shell.env` channel down with it.
    hooks['experimental.chat.system.transform'] = async (input, output) => {
      try {
        if (input?.sessionID && Array.isArray(output?.system)) {
          output.system.push(promptLine(input.sessionID))
        }
      } catch {
        /* never break a turn over an identity hint */
      }
    }
  }

  return hooks
}

export default SessionIdentityPlugin
