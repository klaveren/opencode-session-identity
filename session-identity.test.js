import test from 'node:test'
import assert from 'node:assert/strict'
import SessionIdentityPlugin from './session-identity.js'

test('SessionIdentityPlugin', async (t) => {
  await t.test('skips when enabled: false', async () => {
    const hooks = await SessionIdentityPlugin({}, { enabled: false })
    assert.deepEqual(hooks, {})
  })

  await t.test('shell.env appends OPENCODE_SESSION_ID', async () => {
    const hooks = await SessionIdentityPlugin()
    
    const input = { sessionID: 'ses_123' }
    const output = { env: {} }
    
    await hooks['shell.env'](input, output)
    assert.equal(output.env.OPENCODE_SESSION_ID, 'ses_123')
  })

  await t.test('shell.env skips if no sessionID', async () => {
    const hooks = await SessionIdentityPlugin()
    
    const input = {}
    const output = { env: {} }
    
    await hooks['shell.env'](input, output)
    assert.equal(output.env.OPENCODE_SESSION_ID, undefined)
  })

  await t.test('experimental.chat.system.transform appends session prompt', async () => {
    const hooks = await SessionIdentityPlugin()
    
    const input = { sessionID: 'ses_123' }
    const output = { system: ['System prompt.'] }
    
    await hooks['experimental.chat.system.transform'](input, output)
    assert.equal(output.system.length, 2)
    assert.ok(output.system[1].includes('ses_123'))
  })

  await t.test('respects shell: false', async () => {
    const hooks = await SessionIdentityPlugin({}, { shell: false })
    assert.equal(hooks['shell.env'], undefined)
    assert.ok(hooks['experimental.chat.system.transform'])
  })

  await t.test('respects prompt: false', async () => {
    const hooks = await SessionIdentityPlugin({}, { prompt: false })
    assert.ok(hooks['shell.env'])
    assert.equal(hooks['experimental.chat.system.transform'], undefined)
  })

  await t.test('experimental.chat.system.transform gracefully handles missing system array', async () => {
    const hooks = await SessionIdentityPlugin()
    
    const input = { sessionID: 'ses_123' }
    const output = {} // missing system array
    
    // Should not throw
    await hooks['experimental.chat.system.transform'](input, output)
    assert.equal(output.system, undefined)
  })
})
