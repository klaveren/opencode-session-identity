# Changelog

## 2.0.0 (2026-11-02)

- **Breaking:** ported to the OpenCode **v2 plugin API** (`Plugin.define` + `setup(ctx)`). v1 plugin code does not load in v2.
- **Removed:** the shell-env channel. OpenCode v2 injects `OPENCODE_SESSION_ID` into spawned shells **natively**, so the plugin no longer duplicates it. The v1 `shell` and `envVar` options are gone (v2 `shell.create.before` events no longer carry `sessionID`, so a custom env var cannot be set per-session from a plugin).
- **Changed:** the prompt channel uses `ctx.session.hook("context", ...)` and pushes a `{ type: "text", text }` SystemPart (v1 `experimental.chat.system.transform` is removed).
- Entry moved to `index.js`; peer dependency on `@opencode/plugin ^2.2.0`.
