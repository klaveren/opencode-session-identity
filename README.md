# opencode-session-identity

### Ask your agent which session it is running in. It has no idea. Neither does `ps`.

> An opencode plugin that tells an agent its own session id (`ses_…`) — through **both** the shell
> environment and the system prompt, so it can cross-check one against the other.
> **~80 lines. Zero dependencies. Pure JS.**

This sounds like a triviality until you try to write an audit trail, attribute cost per session, or
have an agent report where it did its work. Then it is the one fact the runtime withholds.

---

## Is this your problem?

- You want an **audit log** that records which session performed an action, and you have nowhere to
  read the id from
- You are trying to **attribute token cost per session** and cannot correlate your own records with
  `GET /session/:id/message`
- You asked an agent for its session id and it **guessed, hallucinated, or said it could not know**
- You tried scraping it from `ps`, the opencode logs, or `opencode.db` — and it broke the moment two
  agents ran at once
- You went looking for `OPENCODE_SESSION_ID` and found only `OPENCODE` and `OPENCODE_PID`

> **The short version:** opencode does not expose the session id to the agent. This plugin adds it on
> two independent channels — an environment variable for shell commands, and a line in the system
> prompt — so the agent can both *read* it and *verify* it.

---

## TL;DR

opencode does not tell an agent which session it is running in. The runtime environment carries
only `OPENCODE` and `OPENCODE_PID` — there is no `OPENCODE_SESSION_ID`.

This plugin fills that gap on two channels — which also lets an agent **verify one against the
other** before writing an audit record:

```bash
# 1. shell channel — reactive, the agent asks
$ printenv OPENCODE_SESSION_ID
ses_a1b2c3d4e5f6g7h8i9j0k1l2m3
```

```
# 2. prompt channel — proactive, the agent is born knowing
Session identity (opencode): your current sessionID is ses_a1b2c3d4e5f6g7h8i9j0k1l2m3.
```

---

## The Problem

Any integration that records *what an agent did* needs to attribute the action to the session that
performed it. Audit logs, telemetry, cost attribution, state machines that resume a durable
session — all of them key on the session id.

opencode knows that id. The agent doesn't. Without it you end up correlating by timestamp or
parsing `ps` output, both of which break the moment two agents run concurrently.

## Why Two Channels

They fail differently, and the redundancy is deliberate:

| Channel | Hook | Stability | Cost | Behaviour |
| --- | --- | --- | --- | --- |
| **Shell** | `shell.env` | stable | zero | Only present when a shell actually runs |
| **Prompt** | `experimental.chat.system.transform` | **experimental** | ~15 tokens/turn | Always in context, no action needed |

The prompt channel is the convenient one — the agent never has to think about it. But it rides an
**experimental** hook that may change shape or disappear in an opencode release. The shell channel
is boring and durable.

Each is independently toggleable, and the experimental one is wrapped in its own `try/catch`, so a
breaking change upstream degrades this plugin to "shell only" instead of taking it down.

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
// opencode.json
{ "plugin": ["opencode-session-identity"] }
```

Or vendor the single file into your project and register it by path. Restart the opencode server
afterwards — config is cached.

---

## Configuration

A bare string works and uses the defaults. Use the tuple form to pass options:

```jsonc
{
  "plugin": [
    ["./.opencode/custom/plugin/session-identity/session-identity.js", {
      "shell": true,
      "prompt": true
    }]
  ]
}
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master switch. When `false`, no hooks are registered. |
| `shell` | `boolean` | `true` | Expose the id as an env var in every shell invocation. |
| `prompt` | `boolean` | `true` | Append the id to the system prompt. Uses an **experimental** hook. |
| `envVar` | `string` | `"OPENCODE_SESSION_ID"` | Environment variable name for the shell channel. |

**Turn `prompt` off** if you are optimising the cached prefix down to the token and can afford to
have agents run `printenv` on demand. **Turn `shell` off** if your agents never touch a shell.

---

## Internals

Both hooks guard on `sessionID` being present. Shells outside a session context — a plain user
terminal, for instance — simply do not carry one, and the plugin no-ops rather than injecting an
`undefined`.

The prompt line is deliberately short and constant. It sits in the system prompt, which is the very
front of the cached prefix, so it is re-read on **every** turn of the session — a long line here is
paid hundreds of times over. (For the full arithmetic on why position in the prefix matters, see
[`cache-ttl`](https://github.com/klaveren/opencode-cache-ttl).)

---

## Caveats

- **The prompt channel costs tokens.** ~15 per turn, at the front of the prefix. Negligible on its
  own, but it is the kind of thing that adds up across a large agent fleet. Turning it off also
  costs you the cross-check described above — the shell channel alone has nothing to compare with.
- **Experimental hook.** `experimental.chat.system.transform` is not part of opencode's stable API.
  If it disappears, the returned hook key is simply never called — no crash, just silence. Watch
  for the prompt line vanishing and fall back to the shell channel.
- **Registration.** Lives outside `.opencode/plugins/`. Files in `{plugin,plugins}/` are
  auto-discovered as bare strings **without options** — and since auto-discovery merges after
  config files with last-one-wins dedup, a file in both places has its options silently dropped.

---

## Verification

```bash
# shell channel — from inside an agent's shell tool
printenv OPENCODE_SESSION_ID

# prompt channel — just ask the agent
"what is your sessionID?"
```

If the shell channel returns nothing, check that the plugin is registered and that the command
really runs through opencode's shell tool. If the prompt channel is silent but the shell one works,
the experimental hook likely changed upstream.

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
