# Autonomous Coding Agent TUI — Specification Summary

## Product direction

The attached specification defines The Loop as a **keyboard-first control surface for an autonomous software developer**, not as a conventional chat client. The user provides intent, while the agent decides how to inspect, plan, research, implement, test, recover from failures, and verify the project.

## UI requirements

The primary screen remains compact and readable at a glance. It shows the project name, one primary agent state, one concise activity sentence, meaningful progress events, the current task, and a simple input line. Tool-level logs, raw stdout, internal reasoning, and verbose model output belong in the optional details view rather than the main screen.

The required state vocabulary is small: Thinking, Inspecting, Planning, Building, Testing, Fixing, Verifying, Done, Needs input, and Failed. Destructive or irreversible actions require approval, while ordinary development actions should proceed without constant interruptions. Normal development failures should be summarized and recovered from automatically when possible.

## Implemented slice

The boxed Ink screen opens silently, shows “What do you want to build?” before the first task, keeps one primary state visible, shows one concise activity sentence, records short meaningful events, and uses the requested keyboard-first footer: `Enter send`, `Tab details`, `Esc stop`, and `Ctrl+Z undo`.

The `/model` and `/config` actions remain available inside the TUI and are not shown during startup. The main screen does not print the model list, connection test, npm lifecycle banner, tool protocol messages, or raw startup logs. Streaming Claude output, approval prompts, token and cost status, local-first command results, details mode, session resume messaging, and warning-free indexed event rendering are implemented.

## Remaining specification work

A real rollback implementation, scrollable chat history, richer change and test summaries, structured needs-input panels, review views, autonomous task orchestration, and more extensive details content remain deferred. These should be added only as separate, user-approved increments.
