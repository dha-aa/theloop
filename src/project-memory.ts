import { execFile } from "node:child_process";
import { readdir, readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_CHARS = 3000;
const MAX_PROMPT_CHARS = 10000;
const MAX_DIFF_CHARS = 5000;
const DIR = ".theloop";

export interface ProjectMemory {
  root: string;
  index: string;
  context: string;
  activeTasks: string;
  currentChanges: string;
  agentConfig: string;
  decisions: string;
  resume: string;
  diff: string;
  sessionId: string;
}

export interface ProjectSession {
  id: string;
  path: string;
  startedAt: string;
  previous: string;
}

export interface Milestone {
  title: string;
  summary: string;
  verification: string;
  status: "completed" | "in_progress" | "blocked";
}

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

async function bounded(filePath: string, fallback = "(not available)"): Promise<string> {
  try { return (await readFile(filePath, "utf8")).slice(0, MAX_FILE_CHARS).trim() || fallback; }
  catch { return fallback; }
}

function pad(value: number): string { return String(value).padStart(2, "0"); }
function makeSessionId(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }

const seedFiles: Record<string, string> = {
  "config/agent.md": "# Agent Configuration\n\nMode: assisted\nAuto testing: true\nCheckpointing: true\n",
  "config/tools.md": "# Tools\n\nTerminal: enabled\nWeb search: enabled\nGit: enabled\n",
  "config/permissions.md": "# Permissions\n\nFile deletion: ask\nGit reset: ask\nGit push: ask\nNormal commands: ask\n",
  "memory/context.md": "# Context\n\nProject context is initialized automatically.\n",
  "memory/architecture.md": "# Architecture\n\nRecord durable structural information here.\n",
  "memory/conventions.md": "# Conventions\n\nRecord project-specific conventions here.\n",
  "decisions/README.md": "# Decisions\n\nRecord durable architectural decisions here.\n",
  "tasks/active.md": "# Active Tasks\n\nNo active task recorded yet.\n\n## Current\n\nNone.\n\n## Next\n\nChoose the next task.\n",
  "tasks/completed.md": "# Completed\n\nNo completed tasks recorded yet.\n",
  "tasks/blocked.md": "# Blocked\n\nNone.\n",
  "changes/current.md": "# Current Changes\n\nNo meaningful changes recorded yet.\n",
  "sessions/README.md": "# Sessions\n\nEach run creates a session file.\n",
  "checkpoints/README.md": "# Checkpoints\n\nMeaningful recoverable project states go here.\n",
  "logs/README.md": "# Logs\n\nRaw tool logs are kept out of normal model context.\n",
};

async function discover(workspace: string): Promise<string> {
  const files = await readdir(workspace).catch(() => [] as string[]);
  let packageName = path.basename(workspace);
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8")) as { name?: string; scripts?: Record<string, string> };
    packageName = pkg.name || packageName;
    scripts = pkg.scripts || {};
  } catch { /* not a Node project */ }
  const packageManager = files.includes("pnpm-lock.yaml") ? "pnpm" : files.includes("yarn.lock") ? "yarn" : files.includes("package-lock.json") ? "npm" : "unknown";
  const language = files.includes("tsconfig.json") ? "TypeScript" : files.includes("package.json") ? "JavaScript" : files.includes("pyproject.toml") ? "Python" : "unknown";
  const areas = ["src", "app", "lib", "tests", "test", "docs"].filter((item) => files.includes(item));
  return `# Project\n\nName: ${packageName}\nType: software project\n\n## Stack\n\n- ${language}\n- Package manager: ${packageManager}\n- Test command: ${scripts.test ? `${packageManager} test` : "not detected"}\n- Build command: ${scripts.build ? `${packageManager} run build` : "not detected"}\n- Git: ${files.includes(".git") ? "detected" : "not detected"}\n\n## Current State\n\nProject memory initialized automatically.\n\n## Active Task\n\nNone recorded yet.\n\n## Next\n\nDescribe the next development task in the TUI.\n\n## Important Areas\n\n${areas.length ? areas.map((item) => `- ${item}/`).join("\n") : "- No conventional source directories detected."}\n\n## Last Updated\n\n${dateOnly(new Date())}\n`;
}

export async function ensureTheLoop(workspace: string): Promise<{ root: string; created: boolean }> {
  const root = path.join(workspace, DIR);
  const created = !(await exists(root));
  await mkdir(root, { recursive: true });
  for (const [relative, content] of Object.entries(seedFiles)) {
    const filePath = path.join(root, relative);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (!(await exists(filePath))) await writeFile(filePath, content, "utf8");
  }
  const indexPath = path.join(root, "index.md");
  if (!(await exists(indexPath))) await writeFile(indexPath, await discover(workspace), "utf8");
  return { root, created };
}

export async function startProjectSession(workspace: string, goal = "Not specified"): Promise<ProjectSession> {
  const { root } = await ensureTheLoop(workspace);
  const currentPath = path.join(root, "sessions/current.md");
  const previous = await bounded(currentPath, "(no previous session)");
  const now = new Date();
  const id = makeSessionId(now);
  const content = `# Session\n\nStarted: ${now.toISOString()}\n\nGoal: ${goal}\n\n## Completed\n\nNone yet.\n\n## Verified\n\nNone yet.\n\n## Current\n\n${goal}\n\n## Next\n\nContinue the active task.\n\n## Blocked\n\nNone.\n\n## Status\n\nIn Progress\n`;
  const sessionPath = path.join(root, `sessions/${id}.md`);
  await writeFile(sessionPath, content, "utf8");
  await writeFile(currentPath, content, "utf8");
  return { id, path: sessionPath, startedAt: now.toISOString(), previous };
}

export async function finishProjectSession(workspace: string, session: ProjectSession, status: "Completed" | "In Progress" | "Blocked", summary: string): Promise<void> {
  const content = `${await bounded(session.path, "# Session")}\n\n## Final Update\n\n${summary}\n\n## Status\n\n${status}\n`;
  await writeFile(session.path, content, "utf8");
  await writeFile(path.join(workspace, DIR, "sessions/current.md"), content, "utf8");
}

export async function recordMilestone(workspace: string, milestone: Milestone): Promise<void> {
  const { root } = await ensureTheLoop(workspace);
  const now = new Date();
  const entry = `\n## ${milestone.title}\n\nDate: ${now.toISOString()}\n\n${milestone.summary}\n\nVerification: ${milestone.verification}\n\nStatus: ${milestone.status}\n`;
  const currentPath = path.join(root, "changes/current.md");
  await writeFile(currentPath, `${await bounded(currentPath, "# Current Changes")}${entry}\n`, "utf8");
  const historyPath = path.join(root, `changes/history/${dateOnly(now)}.md`);
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${await bounded(historyPath, `# Change History — ${dateOnly(now)}`)}${entry}\n`, "utf8");
}

export async function loadCurrentDiff(workspace: string): Promise<string> {
  try {
    const options = { cwd: workspace, maxBuffer: 50000 };
    const status = await execFileAsync("git", ["status", "--short"], options);
    const unstaged = await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=0"], options);
    const staged = await execFileAsync("git", ["diff", "--cached", "--no-ext-diff", "--unified=0"], options);
    return [`STATUS:\n${status.stdout.trim() || "clean"}`, `UNSTAGED:\n${unstaged.stdout.trim() || "none"}`, `STAGED:\n${staged.stdout.trim() || "none"}`].join("\n\n").slice(0, MAX_DIFF_CHARS);
  } catch { return "(git diff unavailable)"; }
}

export async function loadTheLoopMemory(workspace: string, session?: ProjectSession): Promise<ProjectMemory> {
  const { root } = await ensureTheLoop(workspace);
  const [index, context, activeTasks, currentChanges, agentConfig, decisions, diff] = await Promise.all([
    bounded(path.join(root, "index.md")),
    bounded(path.join(root, "memory/context.md")),
    bounded(path.join(root, "tasks/active.md")),
    bounded(path.join(root, "changes/current.md")),
    bounded(path.join(root, "config/agent.md")),
    bounded(path.join(root, "decisions/README.md")),
    loadCurrentDiff(workspace),
  ]);
  return { root, index, context, activeTasks, currentChanges, agentConfig, decisions, resume: session?.previous || await bounded(path.join(root, "sessions/current.md")), diff, sessionId: session?.id || "none" };
}

export function formatTheLoopContext(memory: ProjectMemory): string {
  return [
    "THELOOP PROJECT MEMORY (bounded startup context)",
    `INDEX:\n${memory.index}`,
    `CONTEXT:\n${memory.context}`,
    `ACTIVE TASKS:\n${memory.activeTasks}`,
    `CURRENT CHANGES:\n${memory.currentChanges}`,
    `AGENT CONFIG:\n${memory.agentConfig}`,
    `DECISIONS:\n${memory.decisions}`,
    `RESUME:\n${memory.resume}`,
    `CURRENT DIFF:\n${memory.diff}`,
  ].join("\n\n").slice(0, MAX_PROMPT_CHARS);
}

export async function loadProjectMemory(workspace: string): Promise<ProjectMemory> { return loadTheLoopMemory(workspace); }
export function formatProjectMemory(memory: ProjectMemory): string { return formatTheLoopContext(memory); }
