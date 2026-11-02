# opencode-session-identity

### Ask your agent which session it is running in. It knows from its context, and can verify it in the environment.

> An opencode **v2** plugin that tells an agent its own session id (`ses_…`) through the system
> prompt, while v2 itself provides `OPENCODE_SESSION_ID` in every shell. The agent can cross-check
> one against the other.
> **~60 lines. Zero runtime dependencies. Pure JS.**

**v2 (2026-11):** OpenCode v2 rewrote the plugin API — v1 plugin code does not load. This release is
ported: `Plugin.define` + `setup(ctx)`, prompt channel on `ctx.session.hook("context")`. The shell
channel was **dropped because v2 does it natively** — the shell tool now injects
`OPENCODE_SESSION_ID` (alongside `AGENT`, `OPENCODE`, `AI_AGENT`) into every spawned shell, verified
on v2.2.5. For the v1 plugin, use the `v1-plugin-api` branch / `opencode-session-identity@1`.

---

## Is this your problem?

- You want an **audit log** that records which session performed an action, and you have nowhere to
  read the id from
- You are trying to **attribute token cost per session** and cannot correlate your own records with
  `GET /session/:id/message`
- You asked an agent for its session id and it **guessed, hallucinated, or said it could not know**
- You tried scraping it from `ps`, the opencode logs, or `opencode.db` — and it broke the moment two
  agents ran at once

> **The short version:** the shell env var is native in v2, but the agent still is not *told* which
> session it is. This plugin adds the proactive half — a line in the system prompt — so the agent can
> both *know* its session id and *verify* it against the live environment.

---

## The Problem

Any integration that records *what an agent did* needs to attribute the action to the session that
performed it. Audit logs, telemetry, cost attribution, state machines that resume a durable
session — all of them key on the session id.

opencode knows that id. The agent doesn't. Without it you end up correlating by timestamp or
parsing `ps` output, both of which break the moment two agents run concurrently.

## Two Halves — One Plugin, One Native

They fail differently, and the redundancy is deliberate:

| Half | Source | Stability | Cost | Behaviour |
| --- | --- | --- | --- | --- |
| **Shell** | opencode v2 native (shell tool env) | stable | zero | Only present when a shell actually runs |
| **Prompt** | `ctx.session.hook("context")` | stable domain hook in v2 | ~15 tokens/turn | Always in context, no action needed |

The prompt half is the convenient one — the agent never has to think about it. In v2 the hook is a
first-class session domain hook (v1's *experimental* `chat.system.transform` is removed), and it is
still wrapped in its own `try/catch`, so a shape change upstream degrades to "shell only" instead of
taking the plugin — or a turn — down.

The shell half went native: v2's shell tool sets `OPENCODE_SESSION_ID` on the `shell.create.before`
env before spawning, so a plugin cannot and need not duplicate it. (The v2 hook event no longer
carries `sessionID` at all — `{ command, cwd, timeout, shell, env }` only — so even a custom
`envVar` is impossible from a plugin now.)

> This plugin merges what used to be two separate files (`session-env.js` and `session-prompt.js`),
> which were kept apart precisely for that isolation. Per-channel toggles plus the internal guard
> give the same protection in one place.

### The channels cross-check each other

An unplanned benefit, observed in production. The prompt channel puts the id in the model's
**context**; the shell channel reads it from the **live environment**. Those are different sources
of truth, so an agent can use one to audit the other:

```
> without using any tool, do you know the session id?

  Yes — it's in my context: ses_a1b2c3d4e5f6g7h8i9j0k1l2m3.
  One caveat: that's the id the runtime injected into my context, not something I derived.
  If you need the real ses_ for an audit record, the canonical move is to confirm with
  printenv OPENCODE_SESSION_ID, because injected context can drift from the live environment.

> does running the command give the same result?

  Injected context:              ses_a1b2c3d4e5f6g7h8i9j0k1l2m3
  printenv OPENCODE_SESSION_ID:  ses_a1b2c3d4e5f6g7h8i9j0k1l2m3
  Identical.
```

For anything that writes an audit record, that is the right protocol: **read from the prompt,
verify against the shell**. Context is convenient; the environment is authoritative. Running both
channels is what makes the check possible at all.

---

## Install

```bash
npm install opencode-session-identity
```

```jsonc
// opencode.json (v2 key: "plugins")
{ "plugins": ["opencode-session-identity"] }
```

Or vendor the single file into `.opencode/plugins/`. Restart the opencode server afterwards — config
is cached.

---

## Configuration

A bare string works and uses the defaults. Use the object form to pass options:

```jsonc
{
  "plugins": [
    {
      "package": "./plugin/session-identity",
      "options": { "prompt": true }
    }
  ]
}
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch. When `false`, no hooks are registered. |
| `prompt` | `boolean` | `true` | Append the id to the system prompt on every agent model request. |

**Turn `prompt` off** if you are optimising the cached prefix down to the token and can afford to
have agents run `printenv OPENCODE_SESSION_ID` on demand.

---

## Internals

The hook guards on `sessionID` being present and on `event.system` being an array — a v2
`SystemPart` is `{ type: "text", text }`, not a bare string as in v1. Requests outside a session
context simply do not carry one, and the plugin no-ops rather than injecting an `undefined`.

The prompt line is deliberately short and constant. It sits in the system prompt, which is the very
front of the cached prefix, so it is re-read on **every** turn of the session — a long line here is
paid hundreds of times over. (For the full arithmetic on why position in the prefix matters, see
[`cache-ttl`](https://github.com/klaveren/opencode-cache-ttl).)

---

## Caveats

- **The prompt channel costs tokens.** ~15 per turn, at the front of the prefix. Negligible on its
  own, but it is the kind of thing that adds up across a large agent fleet. Turning it off also
  costs you the cross-check described above — with prompt off there is nothing to compare the
  environment against.
- **v1 does not load in v2.** The v1 object entrypoint and `shell.env` /
  `experimental.chat.system.transform` hook keys are gone. Pin `opencode-session-identity@1` on
  opencode 1.x; this 2.0 requires opencode v2 and `@opencode/plugin` ^2.2.

---

## Verification

```bash
# shell half — native since v2, from inside an agent's shell tool
printenv OPENCODE_SESSION_ID

# prompt half — just ask the agent
"what is your sessionID?"
```

If `printenv` returns nothing, the opencode version predates the native injection (or the command
does not run through opencode's shell tool). If the agent does not know its id, check that this
plugin appears in `opencode plugin list` / `/plugins`.

---

## What this unlocks: measuring what a session actually costs

Knowing the session id is the prerequisite for reading
`GET /session/:id/message` → `info.tokens.cache` and finding out where the money in an agent session
really goes. Doing exactly that produced two sibling plugins:

- **[opencode-cache-ttl](https://github.com/klaveren/opencode-cache-ttl)** — Anthropic's prompt cache
  expires after 5 minutes; this raises it to an hour. Measured **92% cheaper** on a 15-minute gap.
  The config route for this does not work, in two different ways, both documented there.
- **[opencode-session-keepalive](https://github.com/klaveren/opencode-session-keepalive)** — keeps an
  idle session's cache warm with minimal pings, and disarms once pinging stops being cheaper than
  re-warming.

The finding that started it: in a long agent session, **~65% of the read cost is the initial context
being re-read on every single turn.**

---

## Credits

Written by **Henrique Van Klaveren**.

## License

MIT — see [`LICENSE`](./LICENSE). Use it however you like.
