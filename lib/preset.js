/**
 * The IDEA preset's plugin rows, as data.
 *
 * This list used to live in `cordis.patch.yml`, inside an `insert` of an
 * `@deepseek-ai/dsh-agent-preset` row. It moved here because registration is
 * now a runtime decision: the Host half registers and unregisters the preset
 * itself, so the row list has to be a value it can hand to
 * `agentPresets.register(definition)` while still carrying the MCP address the
 * user typed on the configuration page.
 *
 * The rows are unchanged from the patch, including the `!!js` conditions on
 * `tool-bash`, `tool-pwsh` and `tool-plugin-manager`. They stay in the
 * Loader's own `{ __jsExpr }` form, so each row still evaluates its condition
 * against its own context once it activates.
 */

/** Server name shared by the MCP client row and the policy row. */
export const SERVER_NAME = 'IDEA'

/** Where the JetBrains IDEA MCP server listens unless configured otherwise. */
export const DEFAULT_MCP_URL = 'http://127.0.0.1:64342/stream'

/**
 * Provider-independent rows: persona, file/shell/search tools, planning and
 * compaction groups, delegation, and the goals, skills and web tools.
 * @type {ReadonlyArray<object>}
 */
export const CORE_ROWS = Object.freeze(
  [
    {
      "id": "persona",
      "name": "@deepseek-ai/dsh-persona",
      "config": {
        "prefix": "你是运行在 JetBrains IDEA 旁的软件工程师，工作在 IDEA 模式。IDE 是当前项目内文件内容的权威来源；项目内的文件读写、搜索、构建、运行通过 IDEA MCP 工具完成。项目外的文件，例如 D:/Note、用户附件和其他仓库，使用 DSH 的本地 read、glob、grep、write、edit，不要传给 IDEA 工具。\n\n工具路由：\n- 读文件用 mcp__IDEA__read_file；大文件用 offset/limit，单次最多 5000 行。\n- 找文件用 mcp__IDEA__search_file；查看目录用 mcp__IDEA__list_directory_tree。\n- 找文本用 mcp__IDEA__search_text 或 mcp__IDEA__search_regex；找符号用 mcp__IDEA__search_symbol；看符号文档用 mcp__IDEA__get_symbol_info；查调用链用 mcp__IDEA__analyze_calls。\n- IDEA 工具集没有 grep、glob、read、write、edit 这些本地工具；不要给本地工具加 mcp__IDEA__ 前缀。项目内搜索用 mcp__IDEA__search_text、mcp__IDEA__search_regex、mcp__IDEA__search_file，本地搜索用 grep、glob。\n- 修改文件前必须先 mcp__IDEA__read_file。已有文件用 mcp__IDEA__apply_patch；新文件用 mcp__IDEA__create_new_file；整文件覆盖用 mcp__IDEA__create_new_file(overwrite=true) 且必须先读。\n- 删除或移动文件用 mcp__IDEA__apply_patch 的 Delete/Move，不用 shell 删除文件。\n- 符号改名用 mcp__IDEA__rename_refactoring；格式化用 mcp__IDEA__reformat_file，只在需要时使用。\n- 构建用 mcp__IDEA__build_project(filesToRebuild) 做增量编译；完整构建和测试用项目自己的 Maven/Gradle。\n- 检查用 mcp__IDEA__lint_files；运行用 mcp__IDEA__get_run_configurations 再 mcp__IDEA__execute_run_configuration。长驻服务用 waitForExit=false，读 fullOutputPath。\n- 需要调试时先加载 idea-debug skill；需要数据库时加载 idea-database；需要重构时加载 idea-refactor。\n- shell 只用于构建、测试和脚本，不用来读写项目源码。\n- 每次调用 IDEA 工具都必须显式传 projectPath，值为运行时上下文 Current working directory 的绝对路径。即使 IDE 只打开一个项目也不能省略；IDE 打开的项目与当前工作区不一致时先问用户。\n- IDEA 工具名必须写完整前缀，例如 mcp__IDEA__read_file、mcp__IDEA__search_symbol，不要直接调用 read_file、search_symbol 这类短名。\n- IDEA 工具只能访问 projectPath 目录内的文件。路径在项目外时改用本地 read、glob、grep，不要用 IDEA 的 read_file、search_file、search_text 读取项目外文件。\n- IDE 不可用或项目不匹配时，明确报告未知或不可用，不要用 shell 猜文件内容。\n\n写文件规则：\n- mcp__IDEA__apply_patch 一次只改一个文件，patch 必须带足够的唯一上下文。\n- 写后 mcp__IDEA__read_file 复查改动区域，再跑 mcp__IDEA__build_project 或 mcp__IDEA__lint_files；出现错误要报告。\n- 不要用 mcp__IDEA__reformat_file 代替实际修改。\n"
      }
    },
    {
      "id": "agent-instructions",
      "name": "@deepseek-ai/dsh-agent-instructions",
      "config": {
        "maxBytes": 65536
      }
    },
    {
      "id": "time-context",
      "name": "@deepseek-ai/dsh-time-context"
    },
    {
      "id": "tool-bash",
      "name": "@deepseek-ai/dsh-tool-bash",
      "disabled": {
        "__jsExpr": "process.platform === 'win32'"
      }
    },
    {
      "id": "tool-pwsh",
      "name": "@deepseek-ai/dsh-tool-pwsh",
      "disabled": {
        "__jsExpr": "process.platform !== 'win32'"
      }
    },
    {
      "id": "tool-fs",
      "name": "@deepseek-ai/dsh-tool-fs",
      "config": {
        "read": true,
        "readImage": true,
        "write": true,
        "edit": true,
        "applyPatch": true
      }
    },
    {
      "id": "tool-fs-search",
      "name": "@deepseek-ai/dsh-tool-fs-search",
      "config": {
        "sampleOverCapGlobResults": false
      }
    },
    {
      "id": "tool-jobs",
      "name": "@deepseek-ai/dsh-tool-jobs"
    },
    {
      "id": "tool-schedule",
      "name": "@deepseek-ai/dsh-tool-schedule"
    },
    {
      "id": "skill-filesystem",
      "name": "@deepseek-ai/dsh-skill-filesystem"
    },
    {
      "id": "tool-skill",
      "name": "@deepseek-ai/dsh-tool-skill"
    },
    {
      "id": "command-goal",
      "name": "@deepseek-ai/dsh-command-goal"
    },
    {
      "id": "tool-goal",
      "name": "@deepseek-ai/dsh-tool-goal"
    },
    {
      "id": "planning",
      "name": "cordis:group",
      "group": true,
      "isolate": {
        "planMode": true
      },
      "config": [
        {
          "id": "plan-mode",
          "name": "@deepseek-ai/dsh-plan-mode",
          "config": {
            "section": "You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.\n\nExplore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.\n\nThe tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.\n\nResolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.\n\nMake the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.\n\nWhen ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask \"should I proceed?\" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.\n"
          }
        }
      ]
    },
    {
      "id": "compaction",
      "name": "cordis:group",
      "group": true,
      "isolate": {
        "compaction": true,
        "toolResultPruner": true
      },
      "config": [
        {
          "id": "compaction-basic",
          "name": "@deepseek-ai/dsh-compaction-basic"
        },
        {
          "id": "command-compact",
          "name": "@deepseek-ai/dsh-command-compact"
        },
        {
          "id": "tool-result-pruner",
          "name": "@deepseek-ai/dsh-compaction-tool-result-pruner",
          "config": {
            "thresholdChars": 8192,
            "headChars": 4096,
            "tailChars": 1024
          }
        }
      ]
    },
    {
      "id": "delegation",
      "name": "cordis:group",
      "group": true,
      "isolate": {
        "workflowEngine": true
      },
      "config": [
        {
          "id": "tool-subagent-control",
          "name": "@deepseek-ai/dsh-tool-subagent-control"
        },
        {
          "id": "tool-subagent",
          "name": "@deepseek-ai/dsh-tool-subagent",
          "config": {
            "provider": "spawn",
            "toolName": "subagent",
            "modelSelection": true,
            "modelDiscovery": true
          }
        },
        {
          "id": "tool-subagent-fork",
          "name": "@deepseek-ai/dsh-tool-subagent",
          "config": {
            "provider": "fork",
            "toolName": "subagent_fork"
          }
        },
        {
          "id": "workflow-ptc",
          "name": "@deepseek-ai/dsh-workflow-ptc",
          "config": {
            "provider": "spawn"
          }
        },
        {
          "id": "tool-workflow",
          "name": "@deepseek-ai/dsh-tool-workflow"
        }
      ]
    },
    {
      "id": "tool-ask-user",
      "name": "@deepseek-ai/dsh-tool-ask-user"
    },
    {
      "id": "tool-todo",
      "name": "@deepseek-ai/dsh-tool-todo",
      "config": {
        "allowParallelInProgress": true
      }
    },
    {
      "id": "tool-web",
      "name": "@deepseek-ai/dsh-tool-web",
      "config": {
        "fetch": true,
        "searchTimeoutMs": 60000
      }
    },
    {
      "id": "present",
      "name": "@deepseek-ai/dsh-tool-present"
    },
    {
      "id": "tool-plugin-manager",
      "name": "@deepseek-ai/dsh-plugin-manager/tools",
      "disabled": {
        "__jsExpr": "!ctx.get('profileContext')"
      }
    }
  ]
)
