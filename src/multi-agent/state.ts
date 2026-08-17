import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentMessage,
  AgentRecord,
  AgentStateSnapshot,
  AgentTask,
  OrchestrationPlan,
} from "./types.js";

const ROOT = ".theloop";
const AGENTS = "agents";
const MESSAGES = "messages";
const TASKS = "tasks";

async function ensureDirectories(workspace: string): Promise<string> {
  const root = path.join(workspace, ROOT);
  await Promise.all([
    mkdir(path.join(root, AGENTS), { recursive: true }),
    mkdir(path.join(root, MESSAGES), { recursive: true }),
    mkdir(path.join(root, TASKS), { recursive: true }),
  ]);
  return root;
}

function markdownWithJson(title: string, value: unknown): string {
  return `# ${title}\n\n<!-- The JSON block is the durable machine-readable record. -->\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function parseJson<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match?.[1]) throw new Error("TheLoop state record has no JSON block.");
  return JSON.parse(match[1]) as T;
}

async function readRecords<T>(directory: string, prefix: string): Promise<T[]> {
  let entries: string[] = [];
  try { entries = await readdir(directory); } catch { return []; }
  const records: T[] = [];
  for (const entry of entries.filter((name) => name.startsWith(prefix) && name.endsWith(".md")).sort()) {
    try { records.push(parseJson<T>(await readFile(path.join(directory, entry), "utf8"))); } catch { /* ignore malformed historical records */ }
  }
  return records;
}

const idCounters = new Map<string, number>();
function numericId(prefix: string, values: string[], workspace: string): string {
  const max = values.reduce((current, value) => {
    const match = value.match(new RegExp(`^${prefix}-(\\d+)$`));
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  const key = `${workspace}:${prefix}`;
  const next = Math.max(max, idCounters.get(key) ?? 0) + 1;
  idCounters.set(key, next);
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

function now(): string { return new Date().toISOString(); }
async function syncAgentWorkspace(root: string, agent: AgentRecord): Promise<void> {
  const directory = path.join(root, AGENTS, agent.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "state.md"), markdownWithJson("Agent State", agent), "utf8");
  await writeFile(path.join(directory, "task.md"), "# Assigned Task\n\n" + agent.task + "\n", "utf8");
  if (agent.result) await writeFile(path.join(directory, "result.md"), markdownWithJson("Result", agent.result), "utf8");
}

export async function ensureMultiAgentState(workspace: string): Promise<void> {
  await ensureDirectories(workspace);
}

export async function listAgents(workspace: string): Promise<AgentRecord[]> {
  const root = await ensureDirectories(workspace);
  return readRecords<AgentRecord>(path.join(root, AGENTS), "agent-");
}

export async function createAgent(
  workspace: string,
  input: Omit<AgentRecord, "id" | "createdAt" | "updatedAt">,
): Promise<AgentRecord> {
  const root = await ensureDirectories(workspace);
  const current = await listAgents(workspace);
  const createdAt = now();
  const record: AgentRecord = { ...input, id: numericId("agent", current.map((agent) => agent.id), workspace), createdAt, updatedAt: createdAt };
  await writeFile(path.join(root, AGENTS, `${record.id}.md`), markdownWithJson("Agent", record), "utf8");
  await syncAgentWorkspace(root, record);
  return record;
}

export async function updateAgent(workspace: string, id: string, patch: Partial<AgentRecord>): Promise<AgentRecord> {
  const root = await ensureDirectories(workspace);
  const current = (await listAgents(workspace)).find((agent) => agent.id === id);
  if (!current) throw new Error(`Unknown agent: ${id}`);
  const updated: AgentRecord = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now() };
  await writeFile(path.join(root, AGENTS, `${id}.md`), markdownWithJson("Agent", updated), "utf8");
  await syncAgentWorkspace(root, updated);
  return updated;
}

export async function listTasks(workspace: string): Promise<AgentTask[]> {
  const root = await ensureDirectories(workspace);
  return readRecords<AgentTask>(path.join(root, TASKS), "task-");
}

export async function createTask(
  workspace: string,
  input: Omit<AgentTask, "id" | "createdAt" | "updatedAt">,
): Promise<AgentTask> {
  const root = await ensureDirectories(workspace);
  const current = await listTasks(workspace);
  const createdAt = now();
  const task: AgentTask = { ...input, id: numericId("task", current.map((item) => item.id), workspace), createdAt, updatedAt: createdAt };
  await writeFile(path.join(root, TASKS, `${task.id}.md`), markdownWithJson("Task", task), "utf8");
  await writeTaskBoard(workspace);
  return task;
}

export async function updateTask(workspace: string, id: string, patch: Partial<AgentTask>): Promise<AgentTask> {
  const root = await ensureDirectories(workspace);
  const current = (await listTasks(workspace)).find((task) => task.id === id);
  if (!current) throw new Error(`Unknown task: ${id}`);
  const updated: AgentTask = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now() };
  await writeFile(path.join(root, TASKS, `${id}.md`), markdownWithJson("Task", updated), "utf8");
  await writeTaskBoard(workspace);
  return updated;
}

export async function writeTaskBoard(workspace: string): Promise<void> {
  const root = await ensureDirectories(workspace);
  const tasks = await listTasks(workspace);
  const rows = tasks.length === 0
    ? "| None | — | pending | — |\n"
    : tasks.map((task) => `| ${task.title} | ${task.owner ?? "unassigned"} | ${task.status} | ${task.dependencies.join(", ") || "—"} |`).join("\n") + "\n";
  const content = `# Active Tasks\n\n| Task | Agent | Status | Dependencies |\n|---|---|---|---|\n${rows}`;
  await writeFile(path.join(root, TASKS, "active.md"), content, "utf8");
}

export async function savePlan(workspace: string, plan: OrchestrationPlan): Promise<void> {
  const root = await ensureDirectories(workspace);
  await writeFile(path.join(root, TASKS, "plan.md"), markdownWithJson("Orchestration Plan", plan), "utf8");
}

export async function sendMessage(
  workspace: string,
  input: Omit<AgentMessage, "id" | "createdAt">,
): Promise<AgentMessage> {
  const root = await ensureDirectories(workspace);
  const current = await listMessages(workspace);
  const message: AgentMessage = { ...input, id: numericId("message", current.map((item) => item.id), workspace), createdAt: now() };
  const filename = `${message.id}-${message.from}-to-${message.to}.md`;
  await writeFile(path.join(root, MESSAGES, filename), markdownWithJson("Message", message), "utf8");
  return message;
}

export async function listMessages(workspace: string): Promise<AgentMessage[]> {
  const root = await ensureDirectories(workspace);
  return readRecords<AgentMessage>(path.join(root, MESSAGES), "message-");
}

export async function recoverInterruptedState(workspace: string): Promise<void> {
  const [agents, tasks] = await Promise.all([listAgents(workspace), listTasks(workspace)]);
  for (const agent of agents) {
    if (agent.status === "assigned" || agent.status === "working" || agent.status === "verifying") {
      await updateAgent(workspace, agent.id, { status: "waiting", current: "Recovered after a previous process ended; ready for reassignment.", next: "Wait for the orchestrator to resume or cancel this task.", checkpoint: agent.checkpoint ?? "recovered" });
    }
  }
  for (const task of tasks) {
    if (task.status === "working" || task.status === "verifying") {
      await updateTask(workspace, task.id, { status: "waiting", checkpoint: task.checkpoint ?? "recovered" });
    }
  }
}
export async function loadAgentState(workspace: string): Promise<AgentStateSnapshot> {
  const [agents, tasks, messages] = await Promise.all([listAgents(workspace), listTasks(workspace), listMessages(workspace)]);
  return { agents, tasks, messages };
}
