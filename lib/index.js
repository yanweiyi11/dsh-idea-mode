import z from '@deepseek-ai/schemastery'
import * as policyPlugin from './policy.js'
import { CORE_ROWS, DEFAULT_MCP_URL, SERVER_NAME } from './preset.js'

export const name = 'dsh-idea-mode'

/**
 * Services are read through `ctx.get()` rather than declared in `inject`,
 * because a profile may omit any of them: no `mcpManager`, no preset registry,
 * or no config editor. Every consumer below treats absence as "this mode cannot
 * be offered here", which keeps the bundle installable on a minimal profile
 * instead of failing activation.
 */
export const inject = []

/**
 * Live configuration.
 *
 * All three fields are volatile, and that is load-bearing rather than taste:
 * the Settings service only publishes fields covered by some `.volatile()`
 * ancestor (`dsh-settings/lib/types/schema.js:43 volatileForm` returns undefined
 * for anything else), so an ordinary field would never appear on a configuration
 * page at all. Volatile fields also avoid a remount — the Loader commits them
 * into the running fiber and emits `loader/volatile-update`
 * (`cordis-plugin-loader/lib/index.js:520 _commitVolatile`), which is exactly the
 * hook this plugin needs to rebuild its registrations without being torn down.
 *
 * Both booleans default to false: installing the bundle registers nothing until
 * the user asks for a mode.
 */
/** Address used when neither the configuration nor the environment names one. */
const INITIAL_MCP_URL = (() => {
  const fromEnv = typeof process === 'object' ? process.env?.IDEA_MCP_URL : undefined
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : DEFAULT_MCP_URL
})()

export const Config = z.object({
  mcpUrl: z
    .string()
    .default(INITIAL_MCP_URL)
    .description('IDEA MCP 服务地址，例如 http://127.0.0.1:64342/stream。')
    .volatile(),
  registerPreset: z
    .boolean()
    .default(false)
    .description('新建一个 IDEA agent preset，包含 IDEA MCP 工具与工具策略。')
    .volatile(),
  registerIntoStandard: z
    .boolean()
    .default(false)
    .description('不新建 preset，把 IDEA MCP 工具挂到 Host 层，标准模式的 Agent 也能直接使用。')
    .volatile(),
})

/** Preset id; also what `dsh-idea-mode/policy` matches when it gates its tools. */
export const PRESET_ID = 'idea'

const PRESET_META = {
  id: PRESET_ID,
  name: 'IDEA',
  description: 'JetBrains IDEA 文件读写、代码搜索、构建、运行与调试',
  order: 5,
}

/**
 * Read one config field.
 *
 * Volatile fields arrive as `{ get }` handles inside a running fiber and as
 * plain values in the raw config the Loader passes to `apply`. Accepting both
 * keeps one code path correct during activation and during a live update.
 * @param {object} config raw or resolved configuration
 * @param {string} field field name
 * @returns {unknown} the field's current value, or undefined
 */
export function fieldOf(config, field) {
  const value = config?.[field]
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    return value.get()
  }
  return value
}

/**
 * @param {object} config live configuration
 * @returns {string} the trimmed MCP address, falling back to the default
 */
export function urlOf(config) {
  const raw = fieldOf(config, 'mcpUrl')
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text === '' ? DEFAULT_MCP_URL : text
}

/** Transport settings shared by both registration modes. */
export function transportConfig(url) {
  return {
    transport: 'streamable-http',
    url,
    toolCallTimeoutMs: 300000,
    failOnStartupError: false,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 10000,
      maxAttempts: 1000000,
    },
  }
}

/**
 * Build the IDEA preset plugin list for one address.
 *
 * The MCP client row and the policy row are constructed here rather than kept
 * in `lib/preset.js` so the configured address reaches both: the client connects
 * to it, and the policy derives its `mcp__IDEA__` tool prefix from the same
 * server name.
 * @param {string} url IDEA MCP endpoint
 * @returns {object[]} rows ready for `agentPresets.register()`
 */
export function buildPresetPlugins(url) {
  return [
    ...CORE_ROWS,
    {
      id: 'idea-mcp',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: SERVER_NAME, ...transportConfig(url) },
    },
    {
      id: 'idea-policy',
      name: 'dsh-idea-mode/policy',
      config: { serverName: SERVER_NAME, allowSqlWrite: true, openAccess: true },
    },
  ]
}

/**
 * Register the IDEA preset.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {object} config live configuration
 * @returns {Promise<() => Promise<void>>} disposer owned by the caller
 */
async function registerPreset(ctx, config) {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) {
    throw new Error('当前 profile 没有 agent preset 注册表，无法新建 IDEA 模式。')
  }
  return presets.register({
    ...PRESET_META,
    plugins: buildPresetPlugins(urlOf(config)),
  })
}

/**
 * Mount the IDEA MCP client at Host level instead of inside a preset.
 *
 * `mcpManager.register()` is the supported Host-level route: the manager owns
 * the child MCP client instance, reserves the server name against configured
 * entries, and its disposer withdraws the tools before settling. That is what
 * makes this mode work without rewriting any preset declaration — and equally
 * what makes turning the switch off leave nothing behind.
 *
 * The Host MCP server is only half of the mode: `dsh-idea-mode/policy` still has
 * to run somewhere, because it is what fills in `projectPath`, normalizes the
 * IDEA argument spellings, and enforces read-before-edit. Inside the IDEA preset
 * the policy rides along in the preset's plugin list; here it is mounted directly
 * so it governs every agent that can now see the tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {object} config live configuration
 * @returns {Array<() => Promise<void> | void>} disposers owned by the caller
 */
function registerHostServer(ctx, config) {
  const manager = ctx.get('mcpManager')
  if (manager === undefined || typeof manager.register !== 'function') {
    throw new Error('当前 profile 没有 MCP 管理器，无法把 IDEA 工具挂到 Host 层。')
  }
  const disposeServer = manager.register(SERVER_NAME, transportConfig(urlOf(config)))
  const policy = ctx.plugin(policyPlugin, {
    serverName: SERVER_NAME,
    allowSqlWrite: true,
    openAccess: true,
    anyPreset: true,
    // The IDEA preset already carries its own policy; without this the two
    // would normalize and guard every call twice.
    excludePresetIds: [PRESET_ID],
  })
  return [() => disposeServer(), () => policy.dispose()]
}

/**
 * Apply every registration the current configuration asks for.
 *
 * The two modes are independent: each is attempted on its own and a failure in
 * one is logged without stopping the other, because a wrong address or a
 * minimal profile must not take the whole bundle down. Both default to off, so
 * a freshly installed bundle holds no registration at all.
 * @param {import('@deepseek-ai/cordis').Context} ctx plugin context
 * @param {object} config live configuration
 * @param {{preset?: boolean, host?: boolean}} [available] which collaborating
 *   services this profile actually provides; a mode whose service is missing is
 *   skipped rather than reported as a failure
 * @returns {Promise<object[]>} the disposers for the registrations just made
 */
export async function sync(ctx, config, available = { preset: true, host: true }) {
  const disposers = []

  if (fieldOf(config, 'registerPreset') === true && available.preset !== false) {
    try {
      disposers.push(await registerPreset(ctx, config))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-idea-mode: 新建 IDEA 模式失败：${String(error)}`)
    }
  }

  if (fieldOf(config, 'registerIntoStandard') === true && available.host !== false) {
    try {
      disposers.push(...registerHostServer(ctx, config))
    } catch (error) {
      ctx.logger?.warn?.(`dsh-idea-mode: 挂载 IDEA MCP 到 Host 层失败：${String(error)}`)
    }
  }

  return disposers
}

export function apply(ctx, config = {}) {
  let disposers = []
  // 每个模式各自依赖一个服务，且这两个服务由更靠后的行提供。`apply()` 运行时它们
  // 还没激活，而 `ctx.get()` 默认 strict（未激活的服务返回 undefined）——直接探测
  // 会在启动时永远看到 undefined，把功能变成静默 no-op。所以改为等它们就绪。
  const available = { preset: false, host: false }

  const withdraw = async () => {
    const pending = disposers
    disposers = []
    for (const dispose of pending) {
      try {
        await dispose()
      } catch (error) {
        ctx.logger?.warn?.(`dsh-idea-mode: 注销失败：${String(error)}`)
      }
    }
  }

  // 两个服务会各自触发一次重建，热重载也可能连发。重建必须串行，否则并发的
  // withdraw/sync 会互相覆盖 `disposers`，把已经注册好的东西丢掉（表现为
  // 开关都开着却只挂上一个，或关掉后撤不掉）。
  let queue = Promise.resolve()
  const rebuild = () => {
    queue = queue.then(async () => {
      await withdraw()
      disposers = await sync(ctx, config, available)
    }).catch((error) => {
      ctx.logger?.warn?.(`dsh-idea-mode: 应用配置失败：${String(error)}`)
    })
    return queue
  }

  // 两个依赖服务通常在同一个 tick 内先后就绪；合并成一次重建，避免刚挂上就
  // 撤下再挂一次（那会白做一次子树挂载，日志里也会出现成对的无谓注册）。
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    // 首次注册放在微任务里：此时本行已激活、依赖服务也已就绪，Loader 树足以承载
    // 子挂载（preset 注册会挂一整棵子树，不能在自身激活过程中重入）。
    queueMicrotask(() => {
      scheduled = false
      void rebuild()
    })
  }

  // Teardown withdraws whatever is live, so disabling the row or unloading the
  // bundle leaves no preset definition and no Host-level server behind.
  ctx.effect(() => () => withdraw(), 'dsh-idea-mode: registrations')

  ctx.on('loader/volatile-update', () => void rebuild())

  // 两个服务分开等：只有 preset 注册表的 profile 仍能用开关一，只有 MCP 管理器的
  // profile 仍能用开关二。任一服务消失时把对应模式标记为不可用并重建。
  ctx.inject(['agentPresets'], (child) => {
    available.preset = true
    child.effect(() => () => {
      available.preset = false
    }, 'dsh-idea-mode: preset availability')
    schedule()
  })

  ctx.inject(['mcpManager'], (child) => {
    available.host = true
    child.effect(() => () => {
      available.host = false
    }, 'dsh-idea-mode: host availability')
    schedule()
  })
}
