const DEFAULT_SERVER = 'IDEA'
const GLOBAL_FILE_TOOLS = ['read', 'write', 'edit', 'apply_patch', 'glob', 'grep']
const BLOCKED_ROUTER_COMMANDS = new Set([
  'execute_terminal_command',
  'get_file_problems',
  'git_status',
])
const ROUTER_ONLY_TOOLS = [
  'xdebug_control_session',
  'xdebug_evaluate_expression',
  'xdebug_get_debugger_status',
  'xdebug_get_frame_values',
  'xdebug_get_stack',
  'xdebug_get_threads',
  'xdebug_get_value_by_path',
  'xdebug_list_breakpoints',
  'xdebug_remove_breakpoint',
  'xdebug_run_to_line',
  'xdebug_set_breakpoint',
  'xdebug_set_variable',
  'xdebug_start_debugger_session',
  'cancel_sql_query',
  'create_database_connection',
  'edit_database_connection',
  'execute_sql_query',
  'fetch_query_result',
  'get_database_object_description',
  'introspect_schema',
  'list_database_connections',
  'list_database_schemas',
  'list_recent_sql_queries',
  'list_schema_object_kinds',
  'list_schema_objects',
  'preview_table_data',
  'test_database_connection',
  'generate_inspection_kts_api',
  'generate_inspection_kts_examples',
  'generate_psi_tree',
  'run_inspection_kts',
  'rename_refactoring',
  'reformat_file',
  'open_file_in_editor',
  'get_project_dependencies',
  'get_project_modules',
  'execute_terminal_command',
  'get_file_problems',
  'git_status',
]

const compatNotes = new WeakMap()

export const name = 'dsh-idea-policy'
export const inject = ['tools', 'agentPresets']

export function apply(ctx, config = {}) {
  const serverName = stringOr(config.serverName, DEFAULT_SERVER)
  const prefix = `mcp__${serverName}__`
  const allowSqlWrite = config.allowSqlWrite === true
  const openAccess = config.openAccess === true
  const reads = new Map()

  installIdeaArgumentDefaults(ctx, prefix)
  installIdeaSearchAliases(ctx)
  ctx.on('tools/post-execute', (exec, result, next) => {
    const notes = compatNotes.get(exec)
    if (notes === undefined || notes.length === 0) return next()
    return next().then((decision) => {
      if (decision.kind !== 'accept') return decision
      const hint = {
        type: 'text',
        text: `兼容提示：本次调用使用了兼容处理（${notes.join('；')}）。下次请直接使用正确的工具和参数。`,
      }
      return { kind: 'accept', content: [...(decision.content ?? result.content), hint] }
    })
  })

  if (!openAccess) {
    hideGlobalFileTools(ctx)
    hideRouterOnlyTools(ctx, prefix)

    ctx.on('tools/result', (exec, result) => {
      if (result.isError === false && exec.name === prefix + 'read_file' && exec.agent) {
        recordRead(reads, exec)
      }
    })

    ctx.on('agent/disposed', ({ agent }) => {
      reads.delete(agent.id)
    })

    ctx.effect(
      () => ctx.tools.guard((exec) => guard(exec, prefix, reads, allowSqlWrite)),
      'dsh-idea-mode: guard',
    )
  }

  const skills = ctx.get('skills')
  if (skills?.register) {
    for (const skill of SKILLS) {
      ctx.effect(() => skills.register(skill), `dsh-idea-mode: skill ${skill.name}`)
    }
  }
}

function installIdeaSearchAliases(ctx) {
  const localAliases = {
    'mcp__IDEA__grep': 'grep',
    'mcp__IDEA__glob': 'glob',
    'mcp__IDEA__read': 'read',
    'mcp__IDEA__write': 'write',
    'mcp__IDEA__edit': 'edit',
  }
  const bareAliases = {
    read_file: 'mcp__IDEA__read_file',
    search_file: 'mcp__IDEA__search_file',
    search_text: 'mcp__IDEA__search_text',
    search_regex: 'mcp__IDEA__search_regex',
    search_symbol: 'mcp__IDEA__search_symbol',
    get_symbol_info: 'mcp__IDEA__get_symbol_info',
    list_directory_tree: 'mcp__IDEA__list_directory_tree',
    create_new_file: 'mcp__IDEA__create_new_file',
    reformat_file: 'mcp__IDEA__reformat_file',
    rename_refactoring: 'mcp__IDEA__rename_refactoring',
    build_project: 'mcp__IDEA__build_project',
    lint_files: 'mcp__IDEA__lint_files',
    get_run_configurations: 'mcp__IDEA__get_run_configurations',
    execute_run_configuration: 'mcp__IDEA__execute_run_configuration',
    get_project_modules: 'mcp__IDEA__get_project_modules',
    get_project_dependencies: 'mcp__IDEA__get_project_dependencies',
    get_file_problems: 'mcp__IDEA__get_file_problems',
  }
  const groups = [
    { aliases: localAliases, describe: (alias, sourceName) => `${alias} 已转给本地 ${sourceName}` },
    { aliases: bareAliases, describe: (alias, sourceName) => `${alias} 缺少 mcp__IDEA__ 前缀，已转给 ${sourceName}` },
  ]
  ctx.root.on('agent/created', ({ agent }) => {
    try {
      if (ctx.get('agentPresets')?.composedPreset?.(agent.ctx) !== 'idea') return
    } catch {
      return
    }
    const tools = agent.ctx?.tools
    if (typeof tools?.get !== 'function' || typeof tools?.register !== 'function') return
    for (const { aliases, describe } of groups) {
      for (const [alias, sourceName] of Object.entries(aliases)) {
        if (tools.get(alias, agent) !== undefined) continue
        const source = tools.get(sourceName, agent)
        if (source === undefined) continue
        const execute = source.execute
        try {
          tools.register({
            ...source,
            name: alias,
            execute: async (args, exec) => {
              noteCompatibility(exec, [describe(alias, sourceName)])
              return execute(args, exec)
            },
          })
        } catch {
          // A conflicting registration leaves the original tool set untouched.
        }
      }
    }
  })
}

function installIdeaArgumentDefaults(ctx, prefix) {
  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (typeof exec?.name === 'string' && exec.name.startsWith(prefix)) {
        const definition = ideaToolDefinition(ctx, exec)
        const fixes = normalizeIdeaArguments(exec, definition)
        const args = exec.arguments
        const properties = definition?.parameters?.properties
        if (
          isPlainObject(properties) &&
          Object.hasOwn(properties, 'projectPath') &&
          isPlainObject(args) &&
          (args.projectPath === undefined || args.projectPath === '')
        ) {
          const projectPath = ctx.get('workingDirectory')?.get?.(exec.agent?.session)
          if (typeof projectPath === 'string' && projectPath.length > 0) {
            exec.arguments = { ...args, projectPath }
            fixes.push(`projectPath 已自动补全为 ${projectPath}`)
          }
        }
        if (fixes.length > 0) noteCompatibility(exec, fixes)
      }
    } catch {
      // Keep the original call when the working directory is unavailable.
    }
    return next()
  })
}

function ideaToolDefinition(ctx, exec) {
  try {
    return ctx.tools.get(exec.name, exec.agent)
  } catch {
    return undefined
  }
}

function noteCompatibility(exec, fixes) {
  if (exec === undefined || exec === null) return
  const existing = compatNotes.get(exec) ?? []
  for (const fix of fixes) if (!existing.includes(fix)) existing.push(fix)
  compatNotes.set(exec, existing)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeIdeaArguments(exec, definition) {
  const args = exec.arguments
  if (!isPlainObject(args)) return []
  const properties = definition?.parameters?.properties
  if (!isPlainObject(properties)) return []
  const names = new Set(Object.keys(properties))
  const next = { ...args }
  const fixes = []
  let changed = false
  for (const name of names) {
    for (const alias of argumentAliases(name)) {
      if (!(alias in next)) continue
      if (!(name in next)) {
        next[name] = next[alias]
        fixes.push(`${alias} -> ${name}`)
        changed = true
      }
      if (!names.has(alias)) {
        delete next[alias]
        changed = true
      }
    }
  }
  if (changed) exec.arguments = next
  return fixes
}

function argumentAliases(name) {
  const aliases = new Set()
  const snake = camelToSnake(name)
  const camel = snakeToCamel(name)
  if (snake !== name) aliases.add(snake)
  if (camel !== name) aliases.add(camel)
  return aliases
}

function camelToSnake(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

function snakeToCamel(value) {
  return value.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())
}

function hideGlobalFileTools(ctx) {
  try {
    const present = new Set(ctx.tools.definitions().map((definition) => definition.name))
    const deny = GLOBAL_FILE_TOOLS.filter((name) => present.has(name))
    if (deny.length > 0) ctx.tools.restrict({ deny })
  } catch {
    // The preset composition is the primary boundary.
  }
}

function hideRouterOnlyTools(ctx, prefix) {
  const presets = ctx.get('agentPresets')
  if (!presets?.composedPreset) return
  const restrictions = new WeakMap()

  const clearRestriction = (agent) => {
    const previous = restrictions.get(agent)
    if (previous === undefined) return
    restrictions.delete(agent)
    try {
      previous.dispose()
    } catch {
      // The agent scope may already be disposed.
    }
  }

  const restrictAgent = (agent) => {
    if (!agent?.ctx?.tools) return
    let active
    try {
      active = presets.composedPreset(agent.ctx) === 'idea'
    } catch {
      return
    }
    if (!active) {
      clearRestriction(agent)
      return
    }

    let deny
    try {
      const present = new Set(agent.ctx.tools.definitions().map((definition) => definition.name))
      deny = [
        ...GLOBAL_FILE_TOOLS,
        ...ROUTER_ONLY_TOOLS.map((name) => prefix + name),
      ].filter((name) => present.has(name))
    } catch {
      return
    }

    const signature = deny.join('\0')
    const previous = restrictions.get(agent)
    if (previous?.signature === signature) return
    clearRestriction(agent)
    if (deny.length === 0) return
    const record = { dispose: undefined, signature }
    restrictions.set(agent, record)
    try {
      record.dispose = agent.ctx.tools.restrict({ deny })
    } catch {
      restrictions.delete(agent)
      // The agent still works with the full IDE tool list if restriction cannot apply.
    }
  }

  const refresh = () => {
    const agents = ctx.get('agents')
    for (const agent of agents?.list?.() ?? []) restrictAgent(agent)
  }

  ctx.effect(() => {
    const offCreated = ctx.root.on('agent/created', ({ agent }) => restrictAgent(agent))
    const offChanged = ctx.root.on('tools/change', refresh)
    const offSelected = ctx.root.on('agent-preset/selected', (sessionId) => {
      const agent = ctx.get('agents')?.get?.(sessionId)
      if (agent !== undefined) restrictAgent(agent)
    })
    const offDisposed = ctx.root.on('agent/disposed', ({ agent }) => clearRestriction(agent))
    return () => {
      offCreated()
      offChanged()
      offSelected()
      offDisposed()
    }
  }, 'dsh-idea-mode: idea tool filter')
}

function guard(exec, prefix, reads, allowSqlWrite) {
  if (!exec.name?.startsWith(prefix)) return undefined
  const tool = exec.name.slice(prefix.length)
  const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
  const agentId = exec.agent?.id

  if (tool === 'execute_terminal_command') {
    return 'IDEA terminal is disabled in this mode. Use the DSH shell.'
  }

  if (tool === 'get_file_problems') {
    return 'IDEA get_file_problems is disabled in this mode. Use lint_files.'
  }

  if (tool === 'git_status') {
    return 'IDEA git_status is disabled in this mode. Use the DSH shell for git status.'
  }

  if (tool === 'execute_sql_query' && !allowSqlWrite) {
    return 'IDEA execute_sql_query is disabled. Use read-only database metadata tools.'
  }

  if (tool === 'apply_patch') {
    const patch = stringOr(args.input, stringOr(args.patch, ''))
    const paths = parsePatchPaths(patch)
    if (paths.length === 0) {
      return 'IDEA apply_patch needs a patch with explicit file paths.'
    }
    for (const entry of paths) {
      if (entry.op === 'add' || entry.op === 'move-to') continue
      if (!wasRead(reads, agentId, args.projectPath, entry.path)) {
        return `IDEA apply_patch requires read_file first: ${entry.path}. Read the file, then retry.`
      }
    }
  }

  if (tool === 'create_new_file' && args.overwrite === true) {
    if (!wasRead(reads, agentId, args.projectPath, args.pathInProject)) {
      return `IDEA create_new_file with overwrite requires read_file first: ${args.pathInProject}.`
    }
  }

  if (tool === 'reformat_file') {
    const files = Array.isArray(args.files) ? args.files : []
    for (const file of files) {
      if (!wasRead(reads, agentId, args.projectPath, file)) {
        return `IDEA reformat_file requires read_file first: ${file}.`
      }
    }
  }

  if (tool === 'execute_tool') {
    const command = stringOr(args.command, '')
    const inner = command.trim().split(/\s+/)[0]
    if (inner && BLOCKED_ROUTER_COMMANDS.has(inner)) {
      return `IDEA router command "${inner}" is disabled in this mode.`
    }
    if (inner === 'execute_sql_query' && !allowSqlWrite) {
      return 'IDEA execute_sql_query is disabled. Use read-only database metadata tools.'
    }
    if (inner === 'reformat_file') {
      const files = parseArrayArgument(command, 'files')
      if (files === undefined || files.length === 0) {
        return 'IDEA router reformat_file needs an explicit --files array.'
      }
      for (const file of files) {
        if (!wasRead(reads, agentId, args.projectPath, file)) {
          return `IDEA reformat_file requires read_file first: ${file}.`
        }
      }
    }
  }

  return undefined
}

function recordRead(reads, exec) {
  const args = exec.arguments ?? {}
  const project = normalizeProject(args.projectPath)
  const path = normalizePath(args.file_path, args.projectPath)
  if (!path || !exec.agent?.id) return

  let byProject = reads.get(exec.agent.id)
  if (!byProject) {
    byProject = new Map()
    reads.set(exec.agent.id, byProject)
  }
  let paths = byProject.get(project)
  if (!paths) {
    paths = new Set()
    byProject.set(project, paths)
  }
  paths.add(path)
}

function wasRead(reads, agentId, projectPath, path) {
  if (!agentId) return false
  const byProject = reads.get(agentId)
  if (!byProject) return false

  const project = normalizeProject(projectPath)
  const relative = normalizePath(path, projectPath)
  if (!relative) return false

  const keys = project ? [project, ''] : [...byProject.keys()]
  for (const key of keys) {
    const paths = byProject.get(key)
    if (!paths) continue
    for (const read of paths) {
      if (read === relative) {
        return true
      }
    }
  }
  return false
}

function parseArrayArgument(command, name) {
  const match = new RegExp(`--${name}\\s*(\\[[^\\]]*\\]|\\S+)`).exec(command)
  if (!match) return undefined
  const raw = match[1]
  if (!raw.startsWith('[')) return [raw.replace(/^["']|["']$/g, '')]
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function parsePatchPaths(patch) {
  const entries = []
  const seen = new Set()
  const add = (op, path) => {
    const key = `${op}\0${path}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ op, path })
  }

  for (const line of String(patch ?? '').split(/\r?\n/)) {
    let match
    if ((match = /^\*\*\*\s+(Add|Update|Delete)\s+File:\s*(.+)$/.exec(line))) {
      add(match[1].toLowerCase(), match[2].trim())
    } else if ((match = /^\*\*\*\s+Move\s+to:\s*(.+)$/.exec(line))) {
      add('move-to', match[1].trim())
    } else if ((match = /^---\s+(?:a\/)?(.+)$/.exec(line))) {
      if (match[1].trim() !== '/dev/null') add('diff-old', match[1].trim())
    } else if ((match = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line))) {
      if (match[1].trim() !== '/dev/null') add('diff-new', match[1].trim())
    }
  }
  return entries
}

function normalizeProject(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function normalizePath(value, projectPath) {
  if (typeof value !== 'string') return ''
  let path = value.trim()
  if (!path) return ''
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(new URL(path).pathname)
    } catch {
      return ''
    }
  }
  path = path.replace(/\\/g, '/')
  const project = typeof projectPath === 'string'
    ? projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    : ''
  if (project) {
    const lowerProject = project.toLowerCase()
    const lowerPath = path.toLowerCase()
    if (lowerPath === lowerProject) path = ''
    else if (lowerPath.startsWith(lowerProject + '/')) path = path.slice(project.length + 1)
  }
  return path.replace(/^\.\/+/, '').replace(/^\/+/, '').toLowerCase()
}

function stringOr(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

const SKILLS = [
  {
    name: 'idea-debug',
    description: 'JetBrains IDEA debugger workflow for breakpoints, stepping, stack, and variable inspection.',
    whenToUse: 'Use when the user asks to debug, set a breakpoint, step through code, or inspect runtime values.',
    source: 'dsh-idea-mode',
    content: [
      '# IDEA debug',
      '',
      '直接调用时工具名加 mcp__IDEA__ 前缀；下面短名用于 execute_tool 命令。',
      '',
      'Use this workflow only for breakpoints, stepping, and runtime inspection. Use execute_run_configuration for ordinary runs.',
      '',
      'These tools are available directly in this open preset. If one is not directly visible, call it through execute_tool with a command string: tool name followed by --name value pairs. Array values use JSON.',
      '',
      '1. Find the run configuration or run point with get_run_configurations.',
      '2. Start debugging with execute_tool: xdebug_start_debugger_session --configurationName <name> --timeout 30000.',
      '   Without a configuration, pass --filePath <project-relative file> --line <line>.',
      '3. Set a breakpoint with execute_tool: xdebug_set_breakpoint --filePath <file> --line <line>.',
      '   Add --condition "<expression>" when needed.',
      '4. Wait for the pause with execute_tool: xdebug_control_session --action WAIT_FOR_PAUSE --timeout 60000.',
      '5. After a pause use xdebug_get_debugger_status, xdebug_get_threads --sessionId <id>,',
      '   xdebug_get_stack --sessionId <id>, xdebug_get_frame_values --sessionId <id> --frameIndex 0,',
      '   xdebug_get_value_by_path --sessionId <id> --path ["obj","field"], and',
      '   xdebug_evaluate_expression --sessionId <id> --expression "<expression>".',
      '6. Resume with xdebug_control_session --action RESUME --sessionId <id>, then WAIT_FOR_PAUSE again.',
      '7. Stop with xdebug_control_session --action STOP --sessionId <id>.',
      '',
      'Rules:',
      '- Do not use xdebug_evaluate_expression for side-effecting code.',
      '- Use xdebug_set_variable only when the user explicitly asks.',
      '- Re-read the stack and frame after every resume or step; do not reuse an old frameIndex.',
    ].join('\n'),
  },
  {
    name: 'idea-database',
    description: 'JetBrains IDEA read-only database metadata and table preview workflow.',
    whenToUse: 'Use when the user asks about database connections, schemas, tables, indexes, or table data.',
    source: 'dsh-idea-mode',
    content: [
      '# IDEA database',
      '',
      '直接调用时工具名加 mcp__IDEA__ 前缀；下面短名用于 execute_tool 命令。',
      '',
      'Use read-only metadata tools by default:',
      '',
      '- list_database_connections',
      '- list_database_schemas --connectionId <id>',
      '- list_schema_objects --connectionId <id> --databaseName <db> --schemaName <schema>',
      '- get_database_object_description --connectionId <id> --databaseName <db> --schemaName <schema> --kind table --objectName <name>',
      '- preview_table_data --connectionId <id> --databaseName <db> --schemaName <schema> --tableName <name> --maxRowCount 20',
      '- list_recent_sql_queries --connectionId <id>',
      '- fetch_query_result --resultSetId <id> --offset 0',
      '',
      'These tools are available directly in this open preset. If one is not directly visible, call it through execute_tool with --name value arguments.',
      '',
      'SQL execution is enabled in this open idea preset. Prefer read-only queries and a read-only database account. Before any DDL or DML statement, confirm the target connection and the impact with the user.',
    ].join('\n'),
  },
  {
    name: 'idea-refactor',
    description: 'JetBrains IDEA symbol rename, formatting, and file move/delete workflow.',
    whenToUse: 'Use when the user asks to rename a symbol, format files, or move/delete project files.',
    source: 'dsh-idea-mode',
    content: [
      '# IDEA refactor',
      '',
      '直接调用时工具名加 mcp__IDEA__ 前缀；下面短名用于 execute_tool 命令。',
      '',
      'Symbol rename: use rename_refactoring directly. If it is not directly visible, use execute_tool with',
      'rename_refactoring --pathInProject <file> --symbolName <old> --newName <new>.',
      'Do not rename a symbol by text replacement.',
      '',
      'Formatting: use reformat_file directly. If it is not directly visible, use execute_tool with reformat_file --files ["<file1>","<file2>"].',
      'Use it only when the user asks or a format check fails. Reformatting can create a large diff; read the file first.',
      '',
      'File delete or move: use apply_patch Delete or Move operations. Do not delete files with the shell.',
    ].join('\n'),
  },
]
