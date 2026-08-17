# Multi-Agent Architecture

The Loop now supports a bounded multi-agent execution path on top of the existing local-first terminal agent. The user submits one goal with `/team <goal>`. A coordinator creates a task graph, chooses only the specialist roles suggested by the goal, persists the graph, and runs dependency-ready workers. Small changes such as a button rename or dark-mode adjustment use one builder rather than creating unnecessary agents.

## Runtime model

The coordinator is represented as an orchestrator agent. Workers are short-lived `ClaudeAgent` instances with their own conversation history. Each worker receives only the overall goal, its assigned task, declared file areas, verification requirements, and completed dependency handoffs. Worker output is streamed into the main Ink chat panel with an agent identifier prefix.

Parallel execution is bounded to two ready tasks. Tasks with dependencies wait until the dependency has completed, and the run is scoped to the task IDs created for that orchestration. Worker creation uses workspace-aware persistent ID allocation so concurrent workers do not reuse an identity. The worker itself remains approval-gated for terminal commands and web search, with the same workspace confinement and dangerous-command protections as the single-agent path.

## Durable state

The multi-agent layer stores machine-readable JSON inside human-readable Markdown records:

```text
.theloop/
├── agents/       agent-01.md, agent-02.md, ...
├── messages/     message-01-agent-02-to-agent-01.md, ...
└── tasks/
    ├── active.md
    ├── plan.md
    └── task-01.md, task-02.md, ...
```

Agent records contain identity, role, lifecycle status, task, workspace, parent, progress, file areas, dependencies, current activity, next action, and result. Task records contain title, description, dependency IDs, owner, status, priority, file areas, verification requirements, and result. Messages are short typed handoffs such as `RESULT`, `CONTRACT`, `BLOCKED`, `WARNING`, or `CONFLICT`.

The Markdown task board is regenerated after task creation or update. This makes the active workflow inspectable after a crash or resumed terminal session without replaying entire model conversations.

## Commands

| Command | Behavior |
|---|---|
| `/team <goal>` | Plan and execute a bounded multi-agent run. |
| `/agents` | Show persisted agent IDs, roles, statuses, and progress. |
| `/tasks` | Show persisted task IDs, titles, and statuses. |
| `/model` | Select and test the live Anthropic model used by future workers. |
| `/config` | Configure the Anthropic API key inside the TUI. |

The existing `/clear`, `/compact`, `/details`, `/exit`, and `/quit` commands remain available. `/team` requires a selected model; local deterministic commands continue to bypass the model and should be used for simple repository inspection.

## Failure and recovery behavior

A worker that throws an error is marked `failed`, its task is marked `failed`, and a `BLOCKED` handoff is persisted to the coordinator. The saved record includes the failure message and the last known task context. The current implementation exposes the durable failure state for inspection and future resume work; automatic replacement-agent retry and interactive reassignment are not yet enabled.

The coordinator detects an unresolved dependency cycle, marks the affected plan tasks as `blocked`, and reports the issue instead of silently running an unsafe order. Final orchestration status is persisted through the existing project milestone journal.

## Deliberate boundaries

This increment implements the shared state model, coordinator planning, dynamic specialist selection, dependency-aware bounded execution, durable handoffs, TUI inspection commands, and deterministic offline checks. It does not yet implement isolated Git worktrees, automatic conflict merging, model-generated structured plans, browser automation workers, live progress percentages from token estimates, automatic retry/reassignment, or a fully scrollable agent dashboard. These remain separate increments because they change execution semantics and need their own approval and tests.
