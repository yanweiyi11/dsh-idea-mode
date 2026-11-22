/**
 * Host 半端的单元测试：注册方式的选择、注销、以及热重载时的重建。
 *
 * 这些用例只跑纯逻辑 —— 假造一个 ctx，把 `agentPresets` 与 `mcpManager` 换成立即
 * 返回 disposer 的桩，然后断言"开关 -> 注册了什么 -> 关掉后留下了什么"。
 */
import assert from 'node:assert/strict'
import {
  Config,
  PRESET_ID,
  apply,
  buildPresetPlugins,
  fieldOf,
  sync,
  urlOf,
} from '../lib/index.js'
import { CORE_ROWS, DEFAULT_MCP_URL, SERVER_NAME } from '../lib/preset.js'

/** 一个够用的 Cordis 上下文替身。 */
function makeContext({ presets = true, manager = true } = {}) {
  const calls = { register: [], unregister: 0, host: [], hostDispose: 0, plugins: [], effects: [] }
  const handlers = new Map()
  const logs = []

  const ctx = {
    logger: {
      warn: (message) => logs.push(String(message)),
    },
    fiber: { await: () => Promise.resolve() },
    root: {
      on: (event, handler) => {
        handlers.set(event, handler)
        return () => {}
      },
    },
    on: (event, handler) => {
      handlers.set(event, handler)
      return () => {}
    },
    effect: (factory) => {
      const off = factory()
      calls.effects.push(off)
      return () => {}
    },
    inject: (deps, callback) => {
      const list = Array.isArray(deps) ? deps : Object.keys(deps)
      const present = list.every((name) => ctx.get(name) !== undefined)
      if (present) callback(ctx)
      return { dispose: async () => {} }
    },
    plugin: (plugin, config) => {
      calls.plugins.push({ plugin, config })
      return { dispose: async () => {} }
    },
    get: (name) => {
      if (name === 'agentPresets') {
        if (!presets) return undefined
        return {
          register: async (definition) => {
            calls.register.push(definition)
            return async () => {
              calls.unregister += 1
            }
          },
        }
      }
      if (name === 'mcpManager') {
        if (!manager) return undefined
        return {
          register: (name, entry) => {
            calls.host.push({ name, entry })
            return () => {
              calls.hostDispose += 1
            }
          },
        }
      }
      return undefined
    },
  }

  return { ctx, calls, handlers, logs }
}

async function run() {
  // ---- schema ----
  const parsed = Config({})
  assert.equal(parsed.mcpUrl.get(), DEFAULT_MCP_URL, 'mcpUrl defaults to the shipped address')
  assert.equal(parsed.registerPreset.get(), false, 'preset switch defaults to off')
  assert.equal(parsed.registerIntoStandard.get(), false, 'host switch defaults to off')

  // 三个字段都必须是 volatile：否则配置页投影不出表单，也就没有热重载。
  for (const field of ['mcpUrl', 'registerPreset', 'registerIntoStandard']) {
    assert.equal(Config.dict[field].meta.volatile, true, `${field} is volatile`)
  }

  // ---- fieldOf / urlOf ----
  assert.equal(fieldOf({ a: { get: () => 7 } }, 'a'), 7, 'volatile handle unwrapped')
  assert.equal(fieldOf({ a: 3 }, 'a'), 3, 'plain value passes through')
  assert.equal(fieldOf(undefined, 'a'), undefined, 'missing config is safe')
  assert.equal(urlOf({ mcpUrl: '  http://host:1/x  ' }), 'http://host:1/x', 'address trimmed')
  assert.equal(urlOf({ mcpUrl: '   ' }), DEFAULT_MCP_URL, 'blank address falls back to the default')
  assert.equal(urlOf({}), DEFAULT_MCP_URL, 'absent address falls back to the default')

  // ---- preset 行 ----
  const rows = buildPresetPlugins('http://127.0.0.1:9999/stream')
  assert.equal(rows.length, CORE_ROWS.length + 2, 'core rows plus the MCP and policy rows')
  const mcp = rows.find((row) => row.id === 'idea-mcp')
  assert.equal(mcp.name, '@deepseek-ai/dsh-mcp-client', 'MCP row uses the shipped client')
  assert.equal(mcp.config.serverName, SERVER_NAME, 'MCP row uses the shared server name')
  assert.equal(mcp.config.url, 'http://127.0.0.1:9999/stream', 'configured address reaches the MCP row')
  const policy = rows.find((row) => row.id === 'idea-policy')
  assert.equal(policy.name, 'dsh-idea-mode/policy', 'policy row points at the policy half')
  assert.equal(policy.config.serverName, SERVER_NAME, 'policy shares the server name')

  // `!!js` 行必须原样保留表达式对象，交给 Loader 各自求值。
  const pwsh = rows.find((row) => row.id === 'tool-pwsh')
  assert.equal(typeof pwsh.disabled.__jsExpr, 'string', 'js expression preserved as a loader expression')

  // ---- 默认全关：什么都不注册 ----
  {
    const { ctx, calls } = makeContext()
    const disposers = await sync(ctx, { registerPreset: false, registerIntoStandard: false })
    assert.equal(disposers.length, 0, 'both off registers nothing')
    assert.equal(calls.register.length, 0, 'no preset registered')
    assert.equal(calls.host.length, 0, 'no host server registered')
  }

  // ---- 只开 preset ----
  {
    const { ctx, calls } = makeContext()
    const config = { mcpUrl: 'http://h:1/s', registerPreset: true, registerIntoStandard: false }
    const disposers = await sync(ctx, config)
    assert.equal(calls.register.length, 1, 'preset registered once')
    assert.equal(calls.register[0].id, PRESET_ID, 'preset id is the documented one')
    assert.equal(calls.host.length, 0, 'host server not registered')
    assert.equal(disposers.length, 1, 'one disposer returned')
    await disposers[0]()
    assert.equal(calls.unregister, 1, 'disposer unregisters the preset')
  }

  // ---- 只开 Host 层 ----
  {
    const { ctx, calls } = makeContext()
    const config = { mcpUrl: 'http://h:2/s', registerPreset: false, registerIntoStandard: true }
    const disposers = await sync(ctx, config)
    assert.equal(calls.register.length, 0, 'no preset registered')
    assert.equal(calls.host.length, 1, 'host server registered once')
    assert.equal(calls.host[0].name, SERVER_NAME, 'host server uses the shared name')
    assert.equal(calls.host[0].entry.url, 'http://h:2/s', 'configured address reaches the host server')
    assert.equal(calls.plugins.length, 1, 'policy mounted alongside the host server')
    assert.equal(calls.plugins[0].config.anyPreset, true, 'host policy governs every preset')
    assert.deepEqual(
      calls.plugins[0].config.excludePresetIds,
      [PRESET_ID],
      'host policy steps aside from the IDEA preset so nothing is applied twice',
    )
    assert.equal(disposers.length, 2, 'server and policy both return disposers')
    for (const dispose of disposers) await dispose()
    assert.equal(calls.hostDispose, 1, 'disposer removes the host server')
  }

  // ---- 两个都开 ----
  {
    const { ctx, calls } = makeContext()
    const config = { mcpUrl: 'http://h:3/s', registerPreset: true, registerIntoStandard: true }
    const disposers = await sync(ctx, config)
    assert.equal(calls.register.length, 1, 'preset registered')
    assert.equal(calls.host.length, 1, 'host server registered too')
    assert.equal(disposers.length, 3, 'preset, server and policy disposers')
    for (const dispose of disposers) await dispose()
    assert.equal(calls.unregister, 1, 'preset withdrawn')
    assert.equal(calls.hostDispose, 1, 'host server withdrawn')
  }

  // ---- 服务不可用时静默跳过 ----
  //
  // 「没有 agentPresets 注册表」不是错误，而是这个 profile 不提供该能力（minimal
  // profile 就是）。标记成不可用后 sync 直接跳过该模式，不写警告也不抛错。
  {
    const { ctx, calls, logs } = makeContext({ presets: false, manager: false })
    const config = { registerPreset: true, registerIntoStandard: true }
    const disposers = await sync(ctx, config, { preset: false, host: false })
    assert.equal(disposers.length, 0, 'nothing registered without the services')
    assert.equal(calls.register.length, 0, 'no preset')
    assert.equal(calls.host.length, 0, 'no host server')
    assert.equal(logs.length, 0, 'a missing service is not a failure')
  }

  // ---- 服务在但调用失败：这才是真错误，必须记下来 ----
  {
    const { ctx, logs } = makeContext()
    ctx.get = ((original) => (name) => {
      if (name === 'agentPresets') {
        return { register: async () => { throw new Error('boom') } }
      }
      return original(name)
    })(ctx.get)
    const disposers = await sync(ctx, { registerPreset: true, registerIntoStandard: false })
    assert.equal(disposers.length, 0, 'failed registration yields no disposer')
    assert.equal(logs.length, 1, 'the failure is reported')
    assert.ok(logs[0].includes('boom'), 'the cause survives into the log')
  }

  // ---- apply + 热重载往返 ----
  //
  // 真实运行时，`apply` 收到的 config 里 volatile 字段是 `{ get }` 句柄，Loader
  // 提交新值时就地更新它们（`cordis-plugin-loader/lib/index.js:520 _commitVolatile`），
  // 对象身份不变。这里用一个可变 state 模拟这一点。
  {
    const { ctx, calls, handlers } = makeContext()
    const state = {
      mcpUrl: 'http://h:5/s',
      registerPreset: false,
      registerIntoStandard: false,
    }
    const live = {
      get mcpUrl() { return { get: () => state.mcpUrl } },
      get registerPreset() { return { get: () => state.registerPreset } },
      get registerIntoStandard() { return { get: () => state.registerIntoStandard } },
    }
    apply(ctx, live)
    // 首轮在 fiber.await() 之后异步起跑。
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.register.length, 0, 'starts with nothing registered')

    const reload = handlers.get('loader/volatile-update')
    assert.equal(typeof reload, 'function', 'volatile updates are observed')

    state.registerPreset = true
    reload()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.register.length, 1, 'switching the preset on registers it')
    assert.equal(
      calls.register[0].plugins.find((row) => row.id === 'idea-mcp').config.url,
      'http://h:5/s',
      'registration carries the live address',
    )

    // 换地址：旧定义必须先注销，再按新地址重建，不能叠加两份。
    state.mcpUrl = 'http://h:6/s'
    reload()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.unregister, 1, 'previous registration withdrawn before rebuilding')
    assert.equal(calls.register.length, 2, 'rebuilt once')
    assert.equal(
      calls.register[1].plugins.find((row) => row.id === 'idea-mcp').config.url,
      'http://h:6/s',
      'rebuilt definition carries the new address',
    )

    // 全部关掉：注销，且不再注册。
    state.registerPreset = false
    reload()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.unregister, 2, 'switching off withdraws the registration')
    assert.equal(calls.register.length, 2, 'nothing new registered')

    // 再打开 Host 模式：走 mcpManager，而不是 preset。
    state.registerIntoStandard = true
    reload()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.host.length, 1, 'host mode mounts the shared server')
    assert.equal(calls.register.length, 2, 'preset count unchanged')
    assert.equal(calls.host[0].entry.url, 'http://h:6/s', 'host server uses the live address')

    // 关掉 Host 模式：服务器被撤下，不留残留。
    state.registerIntoStandard = false
    reload()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.hostDispose, 1, 'host server withdrawn when its switch goes off')
  }

  // ---- 插件卸载时回收 ----
  {
    const { ctx, calls } = makeContext()
    apply(ctx, { mcpUrl: 'http://h:8/s', registerPreset: true, registerIntoStandard: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.register.length, 1, 'preset registered')
    assert.equal(calls.host.length, 1, 'host server registered')
    // 卸载钩子是 apply 里注册的第一个 effect 的清理函数。
    const teardown = calls.effects[0]
    assert.equal(typeof teardown, 'function', 'teardown registered')
    await teardown()
    assert.equal(calls.unregister, 1, 'unload withdraws the preset')
    assert.equal(calls.hostDispose, 1, 'unload withdraws the host server')
  }

  console.log('host tests passed')
}

await run()
