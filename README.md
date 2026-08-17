# The Loop

The Loop is a local-first terminal coding agent built with **Node.js, TypeScript, React, and Ink**. It supports the official Anthropic API, a provider-neutral runtime for OpenAI, Gemini, and OpenRouter, durable `.theloop/` project memory, and bounded specialist-worker orchestration.

## Current capabilities

The single-agent path provides live Anthropic model discovery and selection, provider-aware model routing, API-key configuration from the TUI, streaming responses, approval-controlled terminal execution, workspace confinement, dangerous-command blocking, and web search. Deterministic commands such as `pwd`, `ls`, Git status, package metadata, build, and tests are routed locally without an LLM request.

The project-memory layer initializes `.theloop/` automatically, records session start and completion, detects resumable sessions, journals milestones, and injects bounded current-diff context into Claude. The multi-agent path adds an orchestrator, dynamic specialist selection, dependency-aware task graphs, durable agent workspaces, typed handoffs, worker budgets and timeouts, restart recovery, retry limits, a Markdown task board, and resumable state inspection.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Set one or more provider keys in `.env`, or configure them from the TUI:

```text
/config anthropic sk-ant-...
/config openai sk-...
/config gemini AI...
/config openrouter sk-or-...
```

Use `/providers` to inspect configured providers and `/strategy cheap` or `/strategy best` to select routing behavior. `/model` remains available for live Anthropic model selection and compatibility with the original single-provider flow.

## Global installation

The user-local installer does not require administrator privileges:

```bash
bash ./install.sh
# Preview only:
bash ./install.sh --dry-run
# Diagnostics:
theloop doctor
# Remove installer-owned files while preserving project memory:
theloop --uninstall
```

The installer uses `${HOME}/.theloop` for runtime data and `${HOME}/.local/bin` for the launcher. It preserves project `.theloop/` data and user configuration during normal uninstall.

## Multi-agent usage

After selecting or configuring a provider, submit a goal through the coordinator:

```text
/team Build a dashboard with authentication, an API, and a test pass
```

The coordinator creates only the specialist roles suggested by the goal. A small change uses one worker; a larger goal may create research, backend, frontend, and test tasks. Workers receive task-specific context, persist their own state under `.theloop/agents/<id>/`, and report typed results or blocked handoffs. Inspect the durable workflow with `/agents` and `/tasks`.

See [`docs/multi-agent-architecture.md`](docs/multi-agent-architecture.md), [`docs/provider-architecture.md`](docs/provider-architecture.md), and [`docs/installation.md`](docs/installation.md) for implementation details.

## Safety and cost controls

Terminal commands require approval, execute only within the workspace, and are checked against a dangerous-command blocklist. Responses and tool turns are bounded, conversation history is capped, web searches are limited, and multi-agent execution is capped by configurable agent, parallelism, retry, depth, and runtime limits. Restart recovery marks interrupted workers as waiting rather than silently treating them as complete.

## Keyboard controls and commands

| Key or command | Action |
|---|---|
| `Enter` | Submit the current task |
| `Tab` | Toggle the details panel |
| `Esc` | Pause the current input state |
| `Ctrl+Z` | Report that rollback is not yet available |
| `/model` | Choose from live Anthropic models |
| `/config [provider] [key]` | Configure a provider API key |
| `/providers` | Show provider configuration status |
| `/strategy <name>` | Choose `auto`, `best`, `fast`, `cheap`, `balanced`, or `custom` routing |
| `/team <goal>` | Start a bounded multi-agent run |
| `/agents` | Show persisted worker state |
| `/tasks` | Show the persisted task board |
| `/clear` | Clear the current Claude context |
| `/compact` | Compact the current Claude context |
| `/details` | Toggle the details panel |
| `/exit`, `/quit` | Close and journal the session |

## Verification

```bash
npm run build
npm test
bash -n install.sh uninstall.sh bin/theloop
bash ./install.sh --dry-run
```

The deterministic tests cover multi-agent persistence and planning, provider registration and routing, explicit custom model selection, and no-network fixture behavior. The installer test is isolated to temporary directories during development and verifies idempotent installation, version/doctor commands, and preservation of project memory.

## Deliberately deferred

Isolated Git workspaces, automatic conflict merging, model-generated structured plans, browser automation workers, file read/edit tools with diff previews, `/plan` mode, rollback, scrollable chat history, long-result compression, project indexing and fingerprints, hot/cold memory, and progressive relevance-based context loading remain separate future increments.
