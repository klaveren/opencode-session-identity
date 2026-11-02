import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from './index.js'

/** Minimal ctx stub: captures the hook callback registered by setup. */
function makeCtx(options) {
  const hooks = {}
  return {
    options,
    session: {
      async hook(name, callback) {
        hooks[name] = callback
        return { async dispose() {} }
      },
    },
    _hooks: hooks,
  }
}

test('session-identity (v2)', async (t) => {
  await t.test('defines a stable plugin id', () => {
    assert.equal(plugin.id, 'session-identity')
  })

  await t.test('registers no context hook when enabled: false', async () => {
    const ctx = makeCtx({ enabled: false })
    await plugin.setup(ctx)
    assert.equal(ctx._hooks['context'], undefined)
  })

  await t.test('registers no context hook when prompt: false', async () => {
    const ctx = makeCtx({ prompt: false })
    await plugin.setup(ctx)
    assert.equal(ctx._hooks['context'], undefined)
  })

  await t.test('context hook appends session prompt as SystemPart', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const event = { sessionID: 'ses_123', system: [{ type: 'text', text: 'System prompt.' }] }
    await ctx._hooks['context'](event)
    assert.equal(event.system.length, 2)
    assert.equal(event.system[1].type, 'text')
    assert.ok(event.system[1].text.includes('ses_123'))
  })

  await t.test('context hook skips when no sessionID', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const event = { system: [] }
    await ctx._hooks['context'](event)
    assert.equal(event.system.length, 0)
  })

  await t.test('context hook gracefully handles missing system array', async () => {
    const ctx = makeCtx()
    await plugin.setup(ctx)
    const event = { sessionID: 'ses_123' }
    await ctx._hooks['context'](event) // must not throw
    assert.equal(event.system, undefined)
  })
})
