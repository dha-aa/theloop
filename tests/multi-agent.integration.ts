import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnthropicProvider } from "../src/provider/anthropic.js";
import { MultiAgentOrchestrator } from "../src/multi-agent/orchestrator.js";
import { createAgent, createTask, ensureMultiAgentState, loadAgentState, sendMessage, updateAgent, updateTask } from "../src/multi-agent/state.js";

const workspace = await mkdtemp(path.join(os.tmpdir(), "theloop-multi-agent-"));
await ensureMultiAgentState(workspace);

const agent = await createAgent(workspace, {
  role: "builder",
  status: "assigned",
  task: "Build a fixture",
  workspace,
  progress: 0,
  files: ["src/example"],
  dependsOn: [],
  current: "Assigned",
  next: "Implement",
});
assert.equal(agent.id, "agent-01");
const task = await createTask(workspace, {
  title: "Build fixture",
  description: "Build a deterministic fixture.",
  dependencies: [],
  owner: agent.id,
  status: "ready",
  priority: "normal",
  files: ["src/example"],
  verification: ["build"],
});
assert.equal(task.id, "task-01");
await updateAgent(workspace, agent.id, { taskId: task.id, status: "working", progress: 50 });
await updateTask(workspace, task.id, { status: "done", result: { status: "DONE", summary: "Fixture complete", changedFiles: ["src/example"], tests: ["PASS"] } });
await sendMessage(workspace, { from: agent.id, to: "agent-01", type: "RESULT", body: "Fixture complete", taskId: task.id, files: ["src/example"] });
const snapshot = await loadAgentState(workspace);
assert.equal(snapshot.agents[0]?.status, "working");
assert.equal(snapshot.tasks[0]?.status, "done");
assert.equal(snapshot.messages[0]?.type, "RESULT");
assert.match(await readFile(path.join(workspace, ".theloop", "tasks", "active.md"), "utf8"), /Build fixture/);

const orchestrator = new MultiAgentOrchestrator(new AnthropicProvider(), "claude-haiku-test", workspace);
const plan = await orchestrator.plan("Build a small dark mode button change.");
assert.equal(plan.source, "fallback");
assert.equal(plan.tasks.length, 1);
assert.equal(plan.tasks[0]?.status, "ready");
console.log("multi-agent state and planning checks passed");
