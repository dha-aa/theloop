# Local-First Agent Specification

## Core rule

Do not call the LLM when deterministic runtime code can safely complete the request. Use the smallest useful context when reasoning is actually required.

## Implemented slice

The local intent router runs before the Claude agent. It handles unambiguous read-only or routine project commands directly and renders their results in the Ink chat panel. The LLM is bypassed for these commands.

Initial direct intents:

- list files / show files → project-local directory listing
- pwd / show current directory → current workspace path
- show Git status → short Git status
- show branches → branch list
- show recent commits → recent commit summary
- show changes / show diff → Git diff summary or diff
- run tests → detected package test command
- run build → detected package build command
- show package.json / open package.json → local package metadata

Project memory also loads bounded current Git status and diff context into Claude's system prompt. Persistent `.theloop/` memory provides bounded context, session resume detection, and milestone journaling for direct and Claude tasks.

## Deferred work

Structured output compression, result references, fingerprints, result caching, project indexing, workflow templates, progressive context, hot/cold memory, task-state updates during runs, and token-aware context reduction beyond the existing bounds are intentionally deferred. They should be implemented as separate increments.

## Acceptance criteria

A direct intent must execute without an Anthropic request, display a concise deterministic result in the TUI, update the usage bar without adding model tokens, and leave complex or ambiguous requests on the Claude path. The current live smoke test satisfies these criteria for `pwd`.
