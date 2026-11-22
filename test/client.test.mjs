/**
 * 浏览器半端的冒烟测试。
 *
 * `client.js` 不是 ESM，是 DSH 客户端的自注册脚本：它调用
 * `window.__ModuleLoader__.load({ id, factory })`，由运行时在浏览器里执行 factory。
 * 所以这里不需要浏览器 —— 只要造一个够用的 `window` 与 `require`，把 factory 跑
 * 一遍，就能验证：
 *
 *   1. 注册的 id 与 package.json 的包名一致（不一致运行时按包名就取不到工厂）；
 *   2. factory 能返回 `{ name, inject, apply }` 且 `apply` 不抛；
 *   3. 页面注册到正确的槽位与键（`plugins.bundle.config` / 包名）；
 *   4. 命名空间与 Host 侧的 Loader 行 id 一致（不一致配置读写会打到空处）。
 *
 * 它**不**验证渲染结果 —— 那需要真实 DOM。能渲染是另一回事，别把本文件当渲染证明。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

/** 一个最小的 React 替身：只提供 factory 在模块作用域内取用的那几个成员。 */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: (factory) => factory(),
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  Fragment: 'fragment',
}

const modules = {
  react: React,
  'react/jsx-runtime': { jsx: React.createElement, jsxs: React.createElement },
}

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => loaded.push(definition),
  },
}

// 执行自注册脚本。它只调用一次 load()。
new Function('window', 'require', source)(globalThis.window, (name) => {
  if (!(name in modules)) throw new Error(`测试未提供模块: ${name}`)
  return modules[name]
})

assert.equal(loaded.length, 1, '脚本只注册一个模块')
const definition = loaded[0]

// ---- 1. 模块 id ----
assert.equal(definition.id, pkg.name, '注册的 id 与 package.json 的 name 一致')
assert.equal(typeof definition.factory, 'function', 'factory 是个函数')

// ---- 2. factory 产出 ----
const exported = definition.factory((name) => {
  if (!(name in modules)) throw new Error(`测试未提供模块: ${name}`)
  return modules[name]
})
assert.equal(typeof exported, 'object', 'factory 返回对象')
assert.equal(typeof exported.apply, 'function', 'factory 返回 apply')
for (const service of ['slots', 'locale', 'configForms']) {
  assert.ok(exported.inject.includes(service), `inject 声明了 ${service}`)
}

// ---- 3. apply 的实际行为 ----
//
// 每次调用都拿到自己的一份记录：共用一份的话，后一个用例会读到前一个的残留，
// 断言就变成"上一个用例做了什么"，而不是"这一次做了什么"。
/** 一个够用的客户端 ctx 替身。 */
function makeClientContext({ served = true } = {}) {
  const calls = { locale: [], slots: [], effects: [], forms: [] }
  const form = {
    getSnapshot: () => ({
      status: served ? 'ready' : 'unavailable',
      value: { mcpUrl: 'http://127.0.0.1:64342/stream', registerPreset: false, registerIntoStandard: false },
      base: {},
      user: {},
      revision: 0,
      writable: true,
    }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
    dispose: () => calls.forms.push('dispose'),
  }
  const ctx = {
      effect: (factory, label) => {
        const off = factory()
        calls.effects.push({ label, off })
        return () => {}
      },
      locale: {
        register: (ns, dictionaries) => {
          calls.locale.push({ ns, dictionaries })
          return () => {}
        },
        bind: (ns) => (key) => `${ns}.${key}`,
      },
      configForms: {
        get: (entryId) => {
          calls.forms.push(entryId)
          return form
        },
        whileServed: (namespaces, register) => {
          calls.slots.push({ namespaces, served })
          if (served) register(new Set(namespaces))
          return () => {}
        },
      },
      slots: {
        inject: (name, register) => {
          calls.slots.at(-1).injected = name
          return register()
        },
        register: (options, Component) => {
          calls.slots.at(-1).options = options
          calls.slots.at(-1).component = Component
          return () => {}
        },
      },
  }

  return { ctx, form, calls }
}

// ---- 3a. Host 在服务该命名空间时挂页面 ----
{
  const { ctx, calls } = makeClientContext({ served: true })
  exported.apply(ctx)

  assert.equal(calls.forms[0], 'idea-mode', '读取的命名空间与 Host 的 Loader 行 id 一致')

  const dictionary = calls.locale[0]
  assert.ok(dictionary, '注册了文案')
  for (const key of ['zh', 'en']) {
    assert.equal(typeof dictionary.dictionaries[key], 'object', `文案包含 ${key}`)
  }

  const slot = calls.slots[0]
  assert.deepEqual(slot.namespaces, ['idea-mode'], '监听自己的命名空间')
  assert.equal(slot.injected, 'plugins.bundle.config', '注册到组合包配置槽位')
  assert.equal(slot.options.key, pkg.name, '槽位键是组合包包名')
  assert.equal(typeof slot.component, 'function', '带来了一个页面组件')

  // 每个 effect 都必须带标签，卸载时才看得出是谁没回收。
  for (const effect of calls.effects) {
    assert.equal(typeof effect.label, 'string', `effect 有标签：${effect.label}`)
  }
}

// ---- 3b. Host 不服务时一个页面都不挂 ----
{
  const { ctx, calls } = makeClientContext({ served: false })
  exported.apply(ctx)
  const slot = calls.slots[0]
  assert.equal(slot.options, undefined, '服务端不提供该命名空间时不注册页面')
}

// ---- 4. 文案字典的键必须与组件里 t() 用到的键对得上 ----
{
  const { ctx, calls } = makeClientContext({ served: true })
  exported.apply(ctx)
  const { zh, en } = calls.locale[0].dictionaries
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), '中英文案键集合一致')
  for (const key of Object.keys(zh)) {
    assert.equal(typeof zh[key], 'string', `中文文案 ${key} 是字符串`)
    assert.equal(typeof en[key], 'string', `英文文案 ${key} 是字符串`)
  }
  // 组件里出现过的 t('...') 实参都得在字典里。
  const used = new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'\)/g)].map((match) => match[1]))
  // `t` 也被 `props.t` 遮蔽的地方不算，只校验确定来自本文件字典的键。
  for (const key of used) {
    if (key === 'saved' || key === 'saveFailed') continue // 这些也出现在 Host 侧的日志文案里
    assert.ok(key in zh, `用到的文案键 ${key} 在字典里`)
  }
}

console.log('client tests passed')
