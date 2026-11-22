/**
 * 集成测试：拿 DSH 自己的真实 schema 校验我们产出的东西。
 *
 * 前面两个测试文件用的都是桩，只能证明"逻辑按预期走"；这里要证明的是
 * "产出的 preset 定义和 MCP 配置，DSH 真的会接受"。所以它直接 import
 * DSH 安装目录里的 `@deepseek-ai/dsh-agent-preset` 与
 * `@deepseek-ai/dsh-mcp-client`，用它们的 `Config`（Schemastery schema）
 * 与 `resolveReconnectPolicy` 做校验。
 *
 * 这两个包是 DSH 的私有实现，本仓库不依赖它们，所以：
 *   - 先按包名解析（装进 profile 后通常能解析到）；
 *   - 解析不到就用 `DSH_PACKAGE_ROOT` 指定的安装根；
 *   - 都不行就跳过 schema 校验并明确打印原因 —— 绝不让它假装通过。
 *
 * 用法：
 *   node test/integration.test.mjs
 *   DSH_PACKAGE_ROOT=/path/to/@deepseek-ai/dsh node test/integration.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPresetPlugins, transportConfig } from '../lib/index.js'
import { CORE_ROWS, DEFAULT_MCP_URL, SERVER_NAME } from '../lib/preset.js'

/**
 * 把包名解析成一个可 import 的 URL。
 * @param {string} name 包名
 * @returns {Promise<string|null>} 可 import 的 URL，或 null
 */
async function locate(name) {
  const candidates = []
  candidates.push(name)
  if (process.env.DSH_PACKAGE_ROOT) {
    candidates.push(pathToFileURL(join(process.env.DSH_PACKAGE_ROOT, 'node_modules', name, 'lib', 'index.js')).href)
  }
  // 常见安装位置的后备探测：让本机装好的 DSH 也能直接跑通。
  const fallbacks = [
    '/root/.nvm/versions/node/v26.13.1/lib/node_modules/@deepseek-ai/dsh/node_modules',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
  ]
  for (const root of fallbacks) {
    const entry = join(root, name, 'lib', 'index.js')
    if (existsSync(entry)) candidates.push(pathToFileURL(entry).href)
  }
  for (const candidate of candidates) {
    try {
      await import(candidate)
      return candidate
    } catch {
      // 换下一个候选。
    }
  }
  return null
}

async function run() {
  let checked = 0
  const skipped = []

  // ---- 1. preset 定义要能被 AgentPreset 的 schema 接受 ----
  const presetUrl = await locate('@deepseek-ai/dsh-agent-preset')
  if (presetUrl === null) {
    skipped.push('@deepseek-ai/dsh-agent-preset 未找到')
  } else {
    const mod = await import(presetUrl)
    const AgentPreset = mod.default
    const presetConfig = typeof mod?.Config === 'function' ? mod.Config : AgentPreset?.Config
    assert.equal(typeof presetConfig, 'function', 'AgentPreset 暴露了 Config schema')

    const definition = {
      id: 'idea',
      name: 'IDEA',
      description: 'JetBrains IDEA 文件读写、代码搜索、构建、运行与调试',
      order: 5,
      plugins: buildPresetPlugins(DEFAULT_MCP_URL),
    }
    const parsed = presetConfig(definition)
    assert.equal(parsed.id, 'idea', 'preset id 通过校验')
    assert.equal(parsed.name, 'IDEA', 'preset name 通过校验')
    assert.equal(parsed.order, 5, 'preset order 通过校验')
    assert.equal(Array.isArray(parsed.plugins), true, 'plugins 仍是数组')
    assert.equal(parsed.plugins.length, definition.plugins.length, '每一行都留下了')

    // 行结构：Loader 要求每行有 id 与 name（字符串）。
    const ids = new Set()
    for (const row of parsed.plugins) {
      assert.equal(typeof row.id, 'string', `行 ${JSON.stringify(row.name)} 有 id`)
      assert.equal(typeof row.name, 'string', `行 ${row.id} 有 name`)
      assert.ok(!ids.has(row.id), `preset 内 id 不重复：${row.id}`)
      ids.add(row.id)
    }
    for (const required of ['idea-mcp', 'idea-policy', 'persona', 'tool-fs']) {
      assert.ok(ids.has(required), `preset 里有 ${required} 行`)
    }
    checked += 1
  }

  // ---- 2. MCP 传输配置要能被 McpClient 的 schema 接受 ----
  const clientUrl = await locate('@deepseek-ai/dsh-mcp-client')
  if (clientUrl === null) {
    skipped.push('@deepseek-ai/dsh-mcp-client 未找到')
  } else {
    const mod = await import(clientUrl)
    // 这个包把 Config 作为具名导出（AgentPreset 则是挂在 default 上），
    // 两种形状都认，免得依赖某个包的打包细节。
    const configOf = (m) => (typeof m?.Config === 'function' ? m.Config : m?.default?.Config)
    const mcClientConfig = configOf(mod)
    assert.equal(typeof mcClientConfig, 'function', 'McpClient 暴露了 Config schema')

    const url = 'http://127.0.0.1:9999/stream'
    const parsed = mcClientConfig({ serverName: SERVER_NAME, ...transportConfig(url) })
    assert.equal(parsed.serverName, SERVER_NAME, 'serverName 通过校验')
    assert.match(parsed.serverName, mod.SERVER_NAME_PATTERN, 'serverName 符合命名规则')
    assert.equal(parsed.transport, 'streamable-http', 'transport 通过校验')
    assert.equal(parsed.url, url, '地址原样保留')
    assert.equal(parsed.toolCallTimeoutMs, 300000, '工具超时保留')
    assert.equal(parsed.failOnStartupError, false, '启动失败不阻断')
    assert.equal(parsed.reconnect.enabled, true, '重连默认开启')
    assert.equal(parsed.reconnect.maxAttempts, 1000000, '无限重试的上限值被接受')

    // Reconnect 策略另有一次性校验：选项键必须合法、延迟必须有序。
    const { resolveReconnectPolicy } = mod
    if (typeof resolveReconnectPolicy === 'function') {
      const policy = resolveReconnectPolicy(transportConfig(url).reconnect, 'reconnect')
      assert.equal(policy.enabled, true, '重连策略可用')
    }
    checked += 1
  }

  // ---- 2b. Host 模式的条目要能被 mcp-manager 接受 ----
  //
  // Host 模式不经过 mcp-client 行，而是 `mcpManager.register(name, entry)`；
  // 那条路先过 `ServerEntrySchema` 再过 `validateEntries`，比上面严格得多
  // （transport 专属字段互斥、模板语法、重连策略都要过）。所以必须单独校验。
  const managerUrl = await locate('@deepseek-ai/dsh-mcp-manager')
  if (managerUrl === null) {
    skipped.push('@deepseek-ai/dsh-mcp-manager 未找到')
  } else {
    const mod = await import(managerUrl)
    const managerConfig = typeof mod?.Config === 'function' ? mod.Config : mod?.default?.Config
    assert.equal(typeof managerConfig, 'function', 'mcp-manager 暴露了 Config schema')

    const url = 'http://127.0.0.1:10000/stream'
    // register() 内部就是 `{...entry, enabled: true}` 后过 schema。
    const parsed = managerConfig({ servers: { [SERVER_NAME]: { ...transportConfig(url), enabled: true } } })
    const servers = typeof parsed.servers?.get === 'function' ? parsed.servers.get() : parsed.servers
    const entry = servers[SERVER_NAME]
    assert.ok(entry, 'manager schema 留下了 IDEA 这条')
    assert.equal(entry.transport, 'streamable-http', 'transport 被接受')
    assert.equal(entry.url, url, '地址原样保留')
    assert.equal(entry.command, '', '非 stdio 条目不带 command')
    assert.deepEqual(entry.args, [], '非 stdio 条目不带 args')
    assert.equal(entry.enabled, true, 'register() 会强制 enabled')
    assert.equal(entry.toolCallTimeoutMs, 300000, '工具超时被接受')
    assert.equal(entry.reconnect.maxAttempts, 1000000, '重试上限被接受')
    checked += 1
  }

  // ---- 3. 与 schema 无关的静态不变量 ----
  // `!!js` 表达式对象只能出现在 Loader 允许的位置：我们只用它做 `disabled`。
  const jsExprs = []
  const walk = (value, path) => {
    if (value === null || typeof value !== 'object') return
    if (Object.prototype.hasOwnProperty.call(value, '__jsExpr')) {
      jsExprs.push({ path, expr: value.__jsExpr })
      return
    }
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
  }
  CORE_ROWS.forEach((row) => walk(row, row.id))
  assert.ok(jsExprs.length > 0, '核心行里仍有表达式行需要原样保留')
  for (const found of jsExprs) {
    assert.equal(typeof found.expr, 'string', `${found.path} 的表达式是字符串`)
    assert.ok(
      found.path.endsWith('.disabled'),
      `表达式只出现在 disabled 上，实际在 ${found.path}`,
    )
  }

  // MCP 与 policy 两行是纯数据，不能夹带表达式。
  for (const row of buildPresetPlugins(DEFAULT_MCP_URL).slice(-2)) {
    const before = jsExprs.length
    walk(row, row.id)
    assert.equal(jsExprs.length, before, `${row.id} 不含表达式`)
  }

  console.log(`integration tests passed (${checked} schema 校验, ${jsExprs.length} 个表达式行)`)
  if (skipped.length > 0) {
    console.log(`SKIPPED: ${skipped.join('；')} —— 这些校验没有执行，不能算通过`)
    process.exitCode = 2
  }
}

await run()
