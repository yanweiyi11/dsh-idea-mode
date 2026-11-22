/**
 * dsh-idea-mode —— 浏览器半端：本组合包的配置页。
 *
 * 这个文件**不是 ESM**，是自注册脚本（DSH 的客户端约定）：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {...} })
 *
 * `id` 必须与 package.json 的 name 完全一致，否则运行时按包名取不到这个工厂。
 *
 * 页面注册在 `plugins.bundle.config` 槽位上，以组合包包名为键 —— 也就是说它会
 * 出现在「插件 → dsh-idea-mode」页面的描述与行列表之间，而不是设置里。
 *
 * 三个字段都必须在 Host 侧声明 `.volatile()`：`dsh-settings` 只把
 * volatile 字段投影成可编辑表单（`dsh-settings/lib/types/schema.js:43
 * volatileForm`），而且只有 volatile 改动才不重挂插件 —— Host 半端正是靠
 * `loader/volatile-update` 重新注册 / 注销 preset 与 MCP 服务器的。
 */
window.__ModuleLoader__.load({
  id: 'dsh-idea-mode',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** 配置页用的界面文案。 */
    const zh = {
      title: 'IDEA 模式',
      description: '选择 IDEA 工具以哪种方式注册，并设置 IDEA MCP 服务地址。',
      urlLabel: 'IDEA MCP 地址',
      urlHint: 'JetBrains IDEA 的 MCP 服务端点，默认 http://127.0.0.1:64342/stream。',
      presetLabel: '新建 IDEA 模式',
      presetHint: '注册一个自己的 IDEA agent preset，自带 IDEA 文件、搜索、构建与调试工具。',
      standardLabel: '标准模式也可用',
      standardHint: '不新建 preset，把 IDEA MCP 工具挂到 Host 层，标准模式的 Agent 直接就能调用。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '没有保存成功，数值已保留供你修改。',
      reset: '恢复默认',
      loading: '正在读取配置…',
      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的配置为只读。',
      invalidUrl: '请填 http:// 或 https:// 开头的地址。',
      bothOff: '两个开关都关着时，不注册任何 IDEA 工具。',
      on: '已启用',
      off: '未启用',
    }

    const en = {
      title: 'IDEA mode',
      description: 'Choose how IDEA tools are registered, and where the IDEA MCP server listens.',
      urlLabel: 'IDEA MCP address',
      urlHint: 'The JetBrains IDEA MCP endpoint. Defaults to http://127.0.0.1:64342/stream.',
      presetLabel: 'Create an IDEA preset',
      presetHint: 'Register a dedicated IDEA agent preset carrying the IDEA file, search, build and debug tools.',
      standardLabel: 'Also available in standard mode',
      standardHint: 'Skip the extra preset and mount the IDEA MCP tools at the Host level so standard-mode Agents can call them.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      reset: 'Reset to default',
      loading: 'Reading configuration…',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores configuration read-only.',
      invalidUrl: 'Enter an address starting with http:// or https://.',
      bothOff: 'With both switches off, no IDEA tools are registered.',
      on: 'On',
      off: 'Off',
    }

    const NS = 'dsh-idea-mode'

    /** Host 侧那一行的 Loader id，也就是配置命名空间。 */
    const ENTRY_ID = 'idea-mode'

    const FIELDS = ['mcpUrl', 'registerPreset', 'registerIntoStandard']

    /** 主题 token，跟着宿主明暗主题走。 */
    const T = {
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
      text: 'var(--dsw-alias-label-primary, currentColor)',
      secondary: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))',
      tertiary: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
      layer: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
      accent: 'var(--dsw-alias-label-primary, currentColor)',
      onAccent: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
    }

    /** 只接受 http(s) 地址；空串表示回到默认值。 */
    function isValidUrl(text) {
      if (text.trim() === '') return true
      try {
        const parsed = new URL(text.trim())
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    }

    /** 从快照里取一个字段的当前值。 */
    function valueOf(snapshot, field) {
      const value = snapshot?.value
      return value !== null && typeof value === 'object' ? value[field] : undefined
    }

    /**
     * 把快照投影成本地草稿。
     *
     * `mcpUrl` 缺省时留空串，让输入框显示占位符而不是把默认地址写死进去 ——
     * 不填就等于跟随默认值，用户换了默认地址后不会锁在旧值上。
     */
    function draftOf(snapshot) {
      return {
        mcpUrl: typeof valueOf(snapshot, 'mcpUrl') === 'string' ? valueOf(snapshot, 'mcpUrl') : '',
        registerPreset: valueOf(snapshot, 'registerPreset') === true,
        registerIntoStandard: valueOf(snapshot, 'registerIntoStandard') === true,
      }
    }

    function sameDraft(a, b) {
      return FIELDS.every((field) => a[field] === b[field])
    }

    /**
     * 把草稿和已保存值之间的差异翻成 settings 的 mutate 操作。
     * @returns {object[]} 有序操作列表
     */
    function opsBetween(saved, draft) {
      const ops = []
      if (saved.mcpUrl !== draft.mcpUrl) {
        ops.push(draft.mcpUrl.trim() === ''
          ? { op: 'unset', path: ['mcpUrl'] }
          : { op: 'set', path: ['mcpUrl'], value: draft.mcpUrl.trim() })
      }
      for (const field of ['registerPreset', 'registerIntoStandard']) {
        if (saved[field] !== draft[field]) {
          ops.push({ op: 'set', path: [field], value: draft[field] })
        }
      }
      return ops
    }

    function Field(props) {
      return h(
        'div',
        { style: { display: 'block', marginBottom: '18px' } },
        h('div', { style: { fontSize: '13px', fontWeight: 600, color: T.text } }, props.label),
        props.hint
          ? h('div', { style: { fontSize: '12px', lineHeight: 1.5, color: T.tertiary, marginTop: '2px' } }, props.hint)
          : null,
        h('div', { style: { marginTop: '8px' } }, props.children),
      )
    }

    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked,
          disabled: props.disabled,
          onClick: () => { if (!props.disabled) props.onChange(!props.checked) },
          style: {
            appearance: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            width: '100%',
            font: 'inherit',
            fontSize: '13px',
            textAlign: 'left',
            cursor: props.disabled ? 'default' : 'pointer',
            color: T.text,
            background: 'none',
            border: 0,
            padding: 0,
            opacity: props.disabled ? 0.5 : 1,
          },
        },
        h(
          'span',
          {
            style: {
              flex: '0 0 auto',
              width: '34px',
              height: '20px',
              borderRadius: '10px',
              background: props.checked ? T.accent : 'rgba(127,127,127,0.35)',
              position: 'relative',
              transition: 'background .16s',
            },
          },
          h('span', {
            style: {
              position: 'absolute',
              top: '2px',
              left: props.checked ? '16px' : '2px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: props.checked ? T.onAccent : '#fff',
              transition: 'left .16s',
            },
          }),
        ),
        h('span', { style: { flex: 1, minWidth: 0, color: T.secondary } }, props.state),
      )
    }

    /**
     * 配置页本体。
     *
     * 只读快照走 `useSyncExternalStore`：ConfigFormController 就是
     * `getSnapshot() + subscribe()` 的形态，React 18 的这个 hook 正好对得上，
     * 比手写 useEffect 订阅少一处竞态。
     */
    function ConfigurationPage(props) {
      const t = props.t
      const form = props.form

      const snapshot = React.useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
      )

      const [draft, setDraft] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      // 快照第一次可用时把草稿种下去；之后只在保存回写时重新对齐，
      // 免得用户正在输入时被一次后台刷新清掉。
      // 草稿为 null 表示"没有未保存的改动"，此时直接跟随已保存值。这样不需要
      // 在渲染期播种 state，也不会因为一次后台刷新把用户正在输入的内容清掉。
      const saved = React.useMemo(() => draftOf(snapshot), [snapshot])
      const current = draft ?? saved
      const writable = snapshot?.writable === true && !busy
      const urlOk = isValidUrl(current.mcpUrl)
      const dirty = !sameDraft(saved, current)
      const canSave = writable && dirty && urlOk

      const update = (patch) => setDraft({ ...current, ...patch })

      const save = async () => {
        const ops = opsBetween(saved, current)
        if (ops.length === 0) return
        setBusy(true)
        setNote(null)
        try {
          const ok = await form.mutate(ops, snapshot.revision)
          if (ok) {
            setNote(t('saved'))
            setDraft(null)
          } else {
            setNote(t('saveFailed'))
          }
        } catch (error) {
          setNote(t('saveFailed'))
          console.error('[dsh-idea-mode] save failed', error)
        } finally {
          setBusy(false)
        }
      }

      if (snapshot?.status === 'loading') {
        return h('div', { style: { fontSize: '13px', color: T.tertiary, padding: '8px 0' } }, t('loading'))
      }
      if (snapshot?.status === 'unavailable') {
        return h('div', { style: { fontSize: '13px', color: T.tertiary, padding: '8px 0' } }, t('unavailable'))
      }

      return h(
        'div',
        {
          style: {
            border: T.border,
            background: T.layer,
            borderRadius: '12px',
            padding: '16px',
            color: T.text,
          },
        },
        h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t('title')),
        h(
          'div',
          { style: { fontSize: '12px', lineHeight: 1.5, color: T.tertiary, marginTop: '2px', marginBottom: '16px' } },
          t('description'),
        ),

        h(
          Field,
          { label: t('urlLabel'), hint: t('urlHint') },
          h('input', {
            type: 'text',
            value: current.mcpUrl,
            disabled: !writable,
            spellCheck: false,
            placeholder: 'http://127.0.0.1:64342/stream',
            onChange: (event) => update({ mcpUrl: event.target.value }),
            style: {
              boxSizing: 'border-box',
              width: '100%',
              font: 'inherit',
              fontSize: '13px',
              color: T.text,
              background: 'transparent',
              border: urlOk ? T.border : '1px solid var(--dsw-alias-state-error, #d33)',
              borderRadius: '8px',
              padding: '7px 10px',
              outline: 'none',
            },
          }),
          urlOk ? null : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error, #d33)', marginTop: '4px' } }, t('invalidUrl')),
        ),

        h(
          Field,
          { label: t('presetLabel'), hint: t('presetHint') },
          h(Switch, {
            checked: current.registerPreset,
            disabled: !writable,
            state: current.registerPreset ? t('on') : t('off'),
            onChange: (next) => update({ registerPreset: next }),
          }),
        ),

        h(
          Field,
          { label: t('standardLabel'), hint: t('standardHint') },
          h(Switch, {
            checked: current.registerIntoStandard,
            disabled: !writable,
            state: current.registerIntoStandard ? t('on') : t('off'),
            onChange: (next) => update({ registerIntoStandard: next }),
          }),
        ),

        !current.registerPreset && !current.registerIntoStandard
          ? h('div', { style: { fontSize: '12px', color: T.tertiary, marginBottom: '12px' } }, t('bothOff'))
          : null,

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              disabled: !canSave,
              onClick: save,
              style: {
                appearance: 'none',
                font: 'inherit',
                fontSize: '13px',
                lineHeight: 1.5,
                cursor: canSave ? 'pointer' : 'default',
                border: '1px solid transparent',
                borderRadius: '8px',
                padding: '5px 14px',
                background: 'var(--dsw-alias-label-primary, currentColor)',
                color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
                opacity: canSave ? 1 : 0.4,
              },
            },
            busy ? t('saving') : t('save'),
          ),
          dirty
            ? h(
              'button',
              {
                type: 'button',
                disabled: !writable,
                onClick: () => { setDraft(null); setNote(null) },
                style: {
                  appearance: 'none', font: 'inherit', fontSize: '13px', cursor: writable ? 'pointer' : 'default',
                  background: 'none', border: 0, padding: 0, color: T.secondary, textDecoration: 'underline',
                },
              },
              t('reset'),
            )
            : null,
          note ? h('span', { style: { fontSize: '12px', color: T.tertiary } }, note) : null,
          snapshot?.writable === false
            ? h('span', { style: { fontSize: '12px', color: T.tertiary } }, t('readOnly'))
            : null,
        ),
      )
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-idea-mode: dictionaries')
      const t = ctx.locale.bind(NS)

      const form = ctx.configForms.get(ENTRY_ID)
      ctx.effect(() => () => { form.dispose() }, 'dsh-idea-mode: config form')

      // 只在 Host 真正服务这个命名空间时才挂页面：插件关掉时不动任何东西。
      ctx.effect(
        () => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: 'dsh-idea-mode',
            locale: NS,
            inject: () => ({ t, form }),
          },
          ConfigurationPage,
        ))),
        'dsh-idea-mode: configuration page',
      )
    }

    return { name: 'dsh-idea-mode-client', inject, apply }
  },
})
