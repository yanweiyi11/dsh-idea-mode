import assert from 'node:assert/strict'
import { apply } from '../lib/policy.js'

function makeContext() {
  const guards = []
  const handlers = new Map()
  const restrictions = []
  const skills = []
  const agentPresets = { composedPreset: () => 'idea' }
  const workingDirectory = { get: (session) => session?.cwd }

  return {
    guards,
    handlers,
    restrictions,
    skills,
    ctx: {
      root: {
        on: (event, handler) => {
          handlers.set(event, handler)
          return () => {}
        },
      },
      tools: {
        definitions: () => [],
        get: (name) => name === 'mcp__IDEA__get_symbol_info'
          ? { parameters: { properties: { filePath: {}, line: {}, column: {}, projectPath: {} } } }
          : name === 'mcp__IDEA__read_file'
            ? { parameters: { properties: { file_path: {}, offset: {}, limit: {}, projectPath: {} } } }
            : name === 'mcp__IDEA__execute_sql_query'
              ? { parameters: { properties: { queryText: {}, projectPath: {} } } }
              : name === 'mcp__IDEA__search_file' || name === 'search_file'
                ? { parameters: { properties: { q: {}, paths: {}, projectPath: {} } } }
                : undefined,
        restrict: (filter) => {
          restrictions.push(filter)
          return () => {}
        },
        guard: (guard) => {
          guards.push(guard)
          return () => {}
        },
      },
      on: (event, handler) => {
        handlers.set(event, handler)
        return () => {}
      },
      get: (name) => (name === 'skills'
        ? { register: (skill) => { skills.push(skill); return () => {} } }
        : name === 'agentPresets'
          ? agentPresets
          : name === 'workingDirectory'
            ? workingDirectory
            : undefined),
      effect: (fn) => {
        fn()
        return () => {}
      },
    },
  }
}

function patch(file, op = 'Update') {
  return `*** Begin Patch\n*** ${op} File: ${file}\n@@\n-old\n+new\n*** End Patch`
}

async function run() {
  const { ctx, guards, handlers, skills } = makeContext()
  apply(ctx, { serverName: 'IDEA' })

  assert.equal(guards.length, 1, 'one guard registered')
  assert.equal(skills.length, 3, 'three skills registered')
  assert.deepEqual(skills.map((skill) => skill.name).sort(), ['idea-database', 'idea-debug', 'idea-refactor'])
  assert.ok(skills.every((skill) => typeof skill.source === 'string' && skill.source.length > 0), 'each skill has a source')
  assert.ok(skills.every((skill) => typeof skill.description === 'string' && skill.description.length > 0), 'each skill has a description')
  assert.ok(skills.every((skill) => typeof skill.content === 'string' && skill.content.length > 0), 'each skill has content')

  const preExecute = handlers.get('tools/pre-execute')
  assert.equal(typeof preExecute, 'function', 'tools/pre-execute listener registered')
  const injected = {
    name: 'mcp__IDEA__execute_sql_query',
    arguments: Object.freeze({ queryText: 'select 1' }),
    agent: { session: { cwd: 'D:/proj' } },
  }
  preExecute(injected, () => ({ kind: 'allow' }))
  assert.equal(injected.arguments.projectPath, 'D:/proj', 'missing projectPath filled from working directory')
  const explicit = {
    name: 'mcp__IDEA__read_file',
    arguments: { file_path: 'src/Foo.java', projectPath: 'D:/other' },
    agent: { session: { cwd: 'D:/proj' } },
  }
  preExecute(explicit, () => ({ kind: 'allow' }))
  assert.equal(explicit.arguments.projectPath, 'D:/other', 'explicit projectPath preserved')
  const symbol = {
    name: 'mcp__IDEA__get_symbol_info',
    arguments: Object.freeze({ file_path: 'src/Foo.java', line: 1, column: 1 }),
    agent: { session: { cwd: 'D:/proj' } },
  }
  preExecute(symbol, () => ({ kind: 'allow' }))
  assert.equal(symbol.arguments.filePath, 'src/Foo.java', 'snake_case argument renamed to filePath')
  assert.equal(symbol.arguments.file_path, undefined, 'obsolete snake_case argument removed')
  assert.equal(symbol.arguments.projectPath, 'D:/proj', 'projectPath filled after argument normalization')
  const camelRead = {
    name: 'mcp__IDEA__read_file',
    arguments: Object.freeze({ filePath: 'src/Bar.java' }),
    agent: { session: { cwd: 'D:/proj' } },
  }
  preExecute(camelRead, () => ({ kind: 'allow' }))
  assert.equal(camelRead.arguments.file_path, 'src/Bar.java', 'camelCase argument renamed to file_path')
  assert.equal(camelRead.arguments.filePath, undefined, 'obsolete camelCase argument removed')

  const fileSearch = {
    name: 'search_file',
    arguments: { pattern: '**/*.sql', path: 'D:/proj' },
    agent: { session: { cwd: 'D:/proj' } },
  }
  preExecute(fileSearch, () => ({ kind: 'allow' }))
  assert.equal(fileSearch.arguments.q, '**/*.sql', 'search_file pattern renamed to q')
  assert.equal(fileSearch.arguments.pattern, undefined, 'obsolete search_file pattern removed')
  assert.equal(fileSearch.arguments.projectPath, 'D:/proj', 'bare alias gets projectPath filled')

  const created = handlers.get('agent/created')
  assert.equal(typeof created, 'function', 'agent/created listener registered')
  const agentRestrictions = []
  const agentCtx = {
    tools: {
      definitions: () => [{
        name: 'mcp__IDEA__xdebug_set_breakpoint',
      }, {
        name: 'mcp__IDEA__read_file',
      }],
      restrict: (filter) => {
        agentRestrictions.push(filter)
        return () => {}
      },
    },
  }
  created({ agent: { ctx: agentCtx } })
  assert.equal(agentRestrictions.length, 1, 'idea agent restricted')
  assert.deepEqual(agentRestrictions[0].deny, ['mcp__IDEA__xdebug_set_breakpoint'])

  const guard = guards[0]
  const read = handlers.get('tools/result')
  assert.equal(typeof read, 'function', 'tools/result listener registered')

  const agent = { id: 'agent-1' }
  const projectPath = 'D:/proj'
  const readExec = {
    name: 'mcp__IDEA__read_file',
    arguments: { file_path: 'src/Foo.java', projectPath },
    agent,
  }

  assert.match(
    guard({ name: 'mcp__IDEA__apply_patch', arguments: { input: patch('src/Foo.java'), projectPath }, agent }),
    /read_file first/,
  )

  read(readExec, { isError: false })

  assert.equal(
    guard({ name: 'mcp__IDEA__apply_patch', arguments: { input: patch('src/Foo.java'), projectPath }, agent }),
    undefined,
    'patch allowed after read',
  )

  assert.equal(
    guard({ name: 'mcp__IDEA__apply_patch', arguments: { input: patch('src/Foo.java', 'Add'), projectPath }, agent }),
    undefined,
    'add file patch allowed without read',
  )

  assert.match(
    guard({ name: 'mcp__IDEA__apply_patch', arguments: { input: patch('src/Other.java'), projectPath }, agent }),
    /read_file first/,
  )

  read(
    {
      name: 'mcp__IDEA__read_file',
      arguments: { file_path: 'D:/proj/src/Bar.java', projectPath },
      agent,
    },
    { isError: false },
  )
  assert.equal(
    guard({ name: 'mcp__IDEA__apply_patch', arguments: { input: patch('src/Bar.java'), projectPath }, agent }),
    undefined,
    'absolute read path matches project-relative patch',
  )

  assert.match(
    guard({ name: 'mcp__IDEA__create_new_file', arguments: { pathInProject: 'src/New.java', overwrite: true, projectPath }, agent }),
    /read_file first/,
  )
  assert.equal(
    guard({ name: 'mcp__IDEA__create_new_file', arguments: { pathInProject: 'src/New.java', overwrite: false, projectPath }, agent }),
    undefined,
    'new file allowed',
  )

  assert.match(
    guard({ name: 'mcp__IDEA__execute_terminal_command', arguments: {}, agent }),
    /disabled/,
  )
  assert.match(
    guard({ name: 'mcp__IDEA__execute_tool', arguments: { command: 'execute_terminal_command --command dir' }, agent }),
    /disabled/,
  )
  assert.equal(
    guard({ name: 'mcp__IDEA__execute_tool', arguments: { command: 'xdebug_get_stack --sessionId x' }, agent }),
    undefined,
    'debug router command allowed',
  )
  assert.match(
    guard({
      name: 'mcp__IDEA__execute_tool',
      arguments: { command: 'reformat_file --files ["src/Other.java"]', projectPath },
      agent,
    }),
    /requires read_file first/,
    'router reformat requires read',
  )
  assert.equal(
    guard({
      name: 'mcp__IDEA__execute_tool',
      arguments: { command: 'reformat_file --files ["src/Foo.java"]', projectPath },
      agent,
    }),
    undefined,
    'router reformat allowed after read',
  )
  assert.match(
    guard({ name: 'mcp__IDEA__execute_tool', arguments: { command: 'execute_sql_query --queryText select 1' }, agent }),
    /disabled/,
  )

  const sqlContext = makeContext()
  apply(sqlContext.ctx, { serverName: 'IDEA', allowSqlWrite: true })
  assert.equal(
    sqlContext.guards[0]({ name: 'mcp__IDEA__execute_tool', arguments: { command: 'execute_sql_query --queryText select 1' }, agent }),
    undefined,
    'sql write can be enabled explicitly',
  )

  const openContext = makeContext()
  apply(openContext.ctx, { serverName: 'IDEA', allowSqlWrite: true, openAccess: true })
  assert.equal(openContext.guards.length, 0, 'open access registers no guard')
  assert.equal(openContext.restrictions.length, 0, 'open access registers no tool restriction')
  assert.equal(openContext.skills.length, 3, 'open access still registers skills')

  const aliasContext = makeContext()
  apply(aliasContext.ctx, { serverName: 'IDEA', allowSqlWrite: true, openAccess: true })
  const aliasCreated = aliasContext.handlers.get('agent/created')
  const registered = []
  const localNames = new Set(['grep', 'glob', 'read', 'write', 'edit'])
  const aliasNames = new Set([
    'mcp__IDEA__grep',
    'mcp__IDEA__glob',
    'mcp__IDEA__read',
    'mcp__IDEA__write',
    'mcp__IDEA__edit',
  ])
  const aliasAgent = {
    ctx: {
      tools: {
        get: (name) => localNames.has(name) || (name.startsWith('mcp__IDEA__') && !aliasNames.has(name))
          ? { name, description: '', parameters: { properties: { projectPath: {} } }, execute: () => {} }
          : undefined,
        register: (definition) => {
          registered.push(definition.name)
          return () => {}
        },
      },
    },
  }
  aliasCreated({ agent: aliasAgent })
  for (const name of [
    'mcp__IDEA__edit',
    'mcp__IDEA__glob',
    'mcp__IDEA__grep',
    'mcp__IDEA__read',
    'mcp__IDEA__write',
    'search_file',
    'read_file',
    'search_text',
    'search_symbol',
  ]) assert.ok(registered.includes(name), `alias ${name} registered`)

  console.log('policy tests passed')
}

await run()
