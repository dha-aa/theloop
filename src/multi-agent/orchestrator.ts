import { ClaudeAgent, type ApprovalPrompt, type TextSink } from "../agent.js";
import type { AnthropicProvider } from "../provider/anthropic.js";
import type { ProjectSession } from "../project-memory.js";
import { RoutedAgent } from "../providers/agent.js";
import type { ModelPolicy, ModelRouter } from "../providers/model-router.js";
import {
  createAgent,
  createTask,
  listAgents,
  listTasks,
  loadAgentState,
  recoverInterruptedState,
  savePlan,
  sendMessage,
  updateAgent,
  updateTask,
} from "./state.js";
import type {
  AgentRecord,
  AgentRole,
  AgentResult,
  AgentStateSnapshot,
  AgentTask,
  OrchestrationPlan,
  TaskPriority,
} from "./types.js";

interface TaskDefinition {
  title: string;
  role: AgentRole;
  description: string;
  priority: TaskPriority;
  dependsOn: number[];
  files: string[];
  verification: string[];
}

export interface OrchestratorLimits {
  maxAgents: number;
  maxParallelAgents: number;
  maxRetries: number;
  maxDepth: number;
  maxRuntimeMs: number;
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker runtime exceeded ${timeoutMs}ms.`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
export const DEFAULT_ORCHESTRATOR_LIMITS: OrchestratorLimits = { maxAgents: 8, maxParallelAgents: 2, maxRetries: 0, maxDepth: 1, maxRuntimeMs: 15 * 60 * 1000 };
export interface OrchestratorEvent {
  kind: "plan" | "agent" | "task" | "message" | "error";
  text: string;
}

export interface OrchestrationResult {
  goal: string;
  plan: OrchestrationPlan;
  snapshot: AgentStateSnapshot;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function now(): string { return new Date().toISOString(); }

function isSmallGoal(goal: string): boolean {
  return /\b(rename|typo|copy|button|color|dark mode|small|minor)\b/i.test(goal) && goal.length < 120;
}

function definitionsFor(goal: string): TaskDefinition[] {
  if (isSmallGoal(goal)) {
    return [{
      title: "Implement requested change",
      role: "builder",
      description: goal,
      priority: "normal",
      dependsOn: [],
      files: [],
      verification: ["Inspect the affected code", "Run the narrowest relevant build or test"],
    }];
  }
  const definitions: TaskDefinition[] = [];
  const needsResearch = /\b(research|stripe|payment|compare|production|architecture|library|integration)\b/i.test(goal);
  const needsBackend = /\b(api|backend|server|database|auth|authentication|billing|payment|subscription)\b/i.test(goal);
  const needsFrontend = /\b(ui|frontend|dashboard|page|screen|component|client)\b/i.test(goal);
  if (needsResearch) definitions.push({
    title: "Research and establish implementation constraints",
    role: "researcher",
    description: `Research the relevant technical constraints for: ${goal}. Do not modify application code. Return concise recommendations, sources, and contracts.`,
    priority: "high",
    dependsOn: [],
    files: [],
    verification: ["Record a concise recommendation", "Identify risks and required contracts"],
  });
  if (needsBackend) definitions.push({
    title: "Build backend and data contracts",
    role: "backend",
    description: `Implement the backend, API, authentication, billing, or data layer required by: ${goal}. Preserve existing architecture and document the contract.`,
    priority: "high",
    dependsOn: needsResearch ? [0] : [],
    files: ["src/api", "src/server", "src/services", "src/db"],
    verification: ["Run type checking or build", "Verify the API or data contract"],
  });
  if (needsFrontend) definitions.push({
    title: "Build the user-facing experience",
    role: "frontend",
    description: `Implement the UI required by: ${goal}. Use existing components and consume confirmed contracts instead of redesigning unrelated architecture.`,
    priority: "normal",
    dependsOn: needsBackend ? [definitions.findIndex((item) => item.role === "backend")] : needsResearch ? [0] : [],
    files: ["src/components", "src/pages", "src/app"],
    verification: ["Run type checking or build", "Check the primary user flow"],
  });
  definitions.push({
    title: "Verify the integrated result",
    role: "tester",
    description: `Test the complete result for: ${goal}. Reproduce failures, report evidence, and do not silently change unrelated code.`,
    priority: "high",
    dependsOn: definitions.map((_, index) => index),
    files: ["tests", "test"],
    verification: ["Run the project's build and test commands", "Report failures with evidence"],
  });
  return definitions.length > 1 ? definitions : [{
    title: "Implement and verify the requested change",
    role: "builder",
    description: goal,
    priority: "normal",
    dependsOn: [],
    files: [],
    verification: ["Run the narrowest relevant build or test"],
  }];
}

function planFromDefinitions(goal: string, definitions: TaskDefinition[], tasks: AgentTask[]): OrchestrationPlan {
  const groups: string[][] = [];
  for (const task of tasks) {
    const group = task.dependencies.length === 0 ? (groups[0] ?? []) : [];
    if (group.length > 0) group.push(task.id);
    else if (task.dependencies.length === 0) groups[0] = [...(groups[0] ?? []), task.id];
    else groups.push([task.id]);
  }
  return {
    goal,
    rationale: definitions.length === 1
      ? "The goal is small enough for one specialist; unnecessary parallelism would add coordination overhead."
      : "Workers are split by responsibility and dependency boundaries. Independent research and implementation branches may run together when their files do not overlap.",
    tasks,
    parallelGroups: groups.filter((group) => group.length > 0),
    createdAt: now(),
    source: "fallback",
  };
}

function resultFromRun(text: string, inputTokens: number, outputTokens: number): AgentResult {
  return { status: "DONE", summary: text.slice(0, 2_000) || "Worker completed without a textual summary.", changedFiles: [], tests: [`${inputTokens} input tokens, ${outputTokens} output tokens`] };
}

export class MultiAgentOrchestrator {
  public constructor(
    private readonly provider: AnthropicProvider,
    private readonly modelId: string,
    private readonly workspace: string,
    private readonly session?: ProjectSession,
    private readonly router?: ModelRouter,
    private readonly modelPolicy?: ModelPolicy,
    limits: Partial<OrchestratorLimits> = {},
  ) {
    this.limits = { ...DEFAULT_ORCHESTRATOR_LIMITS, ...limits };
  }
  private readonly limits: OrchestratorLimits;

  public async plan(goal: string, emit: (event: OrchestratorEvent) => void = () => undefined): Promise<OrchestrationPlan> {
    const definitions = definitionsFor(goal);
    const orchestrator = await this.ensureOrchestrator(goal);
    emit({ kind: "agent", text: `${orchestrator.id} coordinating ${definitions.length} task${definitions.length === 1 ? "" : "s"}` });
    const tasks: AgentTask[] = [];
    for (const definition of definitions) {
      const dependencies = definition.dependsOn.map((index) => tasks[index]?.id).filter((id): id is string => Boolean(id));
      const task = await createTask(this.workspace, {
        title: definition.title,
        description: definition.description,
        dependencies,
        status: dependencies.length === 0 ? "ready" : "waiting",
        priority: definition.priority,
        files: definition.files,
        verification: definition.verification,
      });
      tasks.push(task);
      emit({ kind: "task", text: `${task.id} ${task.title} · ${task.status}` });
    }
    const plan = planFromDefinitions(goal, definitions, tasks);
    await savePlan(this.workspace, plan);
    emit({ kind: "plan", text: `Plan ready: ${tasks.length} task${tasks.length === 1 ? "" : "s"}, ${plan.parallelGroups.length} execution group${plan.parallelGroups.length === 1 ? "" : "s"}.` });
    return plan;
  }

  public async run(
    goal: string,
    approve: ApprovalPrompt,
    emit: (event: OrchestratorEvent) => void = () => undefined,
    onText: TextSink = () => undefined,
  ): Promise<OrchestrationResult> {
    await recoverInterruptedState(this.workspace);
    const plan = await this.plan(goal, emit);
    const orchestrator = (await listAgents(this.workspace)).find((agent) => agent.role === "orchestrator" && agent.task === goal);
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    const completed = new Set<string>();
    const planTaskIds = new Set(plan.tasks.map((task) => task.id));
    const orchestratorId = orchestrator?.id ?? "agent-01";
    const processed = new Set<string>();
    while (processed.size < plan.tasks.length) {
      const tasks = await listTasks(this.workspace);
      const ready = tasks.filter((task) => planTaskIds.has(task.id) && !processed.has(task.id) && task.dependencies.every((dependency) => completed.has(dependency)));
      if (ready.length === 0) {
        const blocked = tasks.filter((task) => planTaskIds.has(task.id) && !processed.has(task.id));
        for (const task of blocked) await updateTask(this.workspace, task.id, { status: "blocked" });
        throw new Error("The orchestration plan has an unresolved dependency cycle.");
      }
      const activeAgents = (await listAgents(this.workspace)).filter((agent) => agent.status !== "done" && agent.status !== "cancelled").length;
      const slots = this.limits.maxAgents - activeAgents;
      if (slots <= 0) {
        for (const task of ready) await updateTask(this.workspace, task.id, { status: "blocked" });
        throw new Error(`Agent limit reached (${this.limits.maxAgents}).`);
      }
      const group = ready.slice(0, Math.max(1, Math.min(this.limits.maxParallelAgents, slots)));
      const results = await Promise.all(group.map(async (task) => {
        let result = await this.runWorker(task, goal, orchestratorId, approve, emit, onText);
        for (let retry = 1; !result.ok && retry <= this.limits.maxRetries; retry += 1) {
          await updateTask(this.workspace, task.id, { status: "ready", owner: undefined, result: undefined });
          emit({ kind: "message", text: `Retrying ${task.id} (${retry}/${this.limits.maxRetries})` });
          result = await this.runWorker(task, goal, orchestratorId, approve, emit, onText);
        }
        return result;
      }));
      for (const result of results) {
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        costUsd += result.costUsd;
        processed.add(result.task.id);
        if (result.ok) completed.add(result.task.id);
        else throw new Error(`Worker ${result.agent.id} failed: ${result.error}`);
      }
    }
    if (orchestrator) await updateAgent(this.workspace, orchestrator.id, { status: "done", progress: 100, current: "Integrated worker results and completed final orchestration.", next: "Wait for the next user goal." });
    const snapshot = await loadAgentState(this.workspace);
    return { goal, plan, snapshot, inputTokens, outputTokens, costUsd };
  }

  public async cancel(agentId: string): Promise<void> {
    const agents = await listAgents(this.workspace);
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    await updateAgent(this.workspace, agentId, { status: "cancelled", current: "Cancelled by orchestrator.", next: "No further work." });
    if (agent.taskId) await updateTask(this.workspace, agent.taskId, { status: "cancelled" });
    await sendMessage(this.workspace, { from: "agent-01", to: agentId, type: "WARNING", body: "Worker cancelled by orchestrator.", taskId: agent.taskId });
  }

  public async snapshot(): Promise<AgentStateSnapshot> { return loadAgentState(this.workspace); }

  private async ensureOrchestrator(goal: string): Promise<AgentRecord> {
    const existing = (await listAgents(this.workspace)).find((agent) => agent.role === "orchestrator" && agent.status !== "done" && agent.status !== "cancelled");
    if (existing) return updateAgent(this.workspace, existing.id, { status: "working", task: goal, current: "Planning and delegating work.", next: "Assign independent tasks." });
    return createAgent(this.workspace, {
      role: "orchestrator",
      status: "working",
      task: goal,
      workspace: this.workspace,
      progress: 0,
      files: [],
      dependsOn: [],
      current: "Planning and delegating work.",
      next: "Assign independent tasks.",
    });
  }

  private async runWorker(
    task: AgentTask,
    goal: string,
    orchestratorId: string,
    approve: ApprovalPrompt,
    emit: (event: OrchestratorEvent) => void,
    onText: TextSink,
  ): Promise<{ task: AgentTask; agent: AgentRecord; ok: boolean; error?: string; inputTokens: number; outputTokens: number; costUsd: number }> {
    const worker = await createAgent(this.workspace, {
      role: this.roleForTitle(task.title),
      status: "assigned",
      taskId: task.id,
      task: task.description,
      workspace: this.workspace,
      parent: orchestratorId,
      depth: 1,
      retries: 0,
      budget: { maxRuntimeMs: this.limits.maxRuntimeMs },
      progress: 0,
      files: task.files,
      dependsOn: task.dependencies,
      current: "Assigned and preparing context.",
      next: "Inspect the project and implement the task.",
    });
    await updateTask(this.workspace, task.id, { owner: worker.id, status: "working" });
    await updateAgent(this.workspace, worker.id, { checkpoint: `task:${task.id}:working`, status: "working", progress: 10, current: "Working on the assigned task.", next: "Verify the result and publish a concise handoff." });
    emit({ kind: "agent", text: `${worker.id} ${worker.role} working on ${task.id}` });
    const dependencies = (await listTasks(this.workspace)).filter((item) => task.dependencies.includes(item.id)).map((item) => `${item.id}: ${item.result?.summary ?? "No result yet."}`).join("\n");
    const prompt = [
      `You are worker ${worker.id}, role ${worker.role}, in a coordinated engineering run.`,
      `Overall goal: ${goal}`,
      `Assigned task: ${task.description}`,
      `Relevant file areas: ${task.files.join(", ") || "discover the smallest relevant area"}`,
      `Required verification: ${task.verification.join("; ")}`,
      dependencies ? `Dependency handoffs:\n${dependencies}` : "No dependency handoff is required.",
      "Work only on this task. Keep changes scoped. End with a concise result, changed files, tests, contracts, and follow-up.",
    ].join("\n\n");
    try {
      const agent = this.router
        ? new RoutedAgent(this.router, this.workspace, this.session, this.modelPolicy)
        : new ClaudeAgent(this.provider, this.modelId, this.workspace, this.session);
      const result = await withTimeout(agent.run(prompt, approve, (chunk) => onText(`[${worker.id}] ${chunk}`)), this.limits.maxRuntimeMs);
      const workerResult = resultFromRun(result.text, result.inputTokens, result.outputTokens);
      await updateTask(this.workspace, task.id, { status: "done", result: workerResult, checkpoint: `task:${task.id}:result` });
      await updateAgent(this.workspace, worker.id, { checkpoint: `task:${task.id}:result`, status: "done", progress: 100, result: workerResult, current: "Verified and published the worker result.", next: "Wait for a follow-up task." });
      await sendMessage(this.workspace, { from: worker.id, to: worker.parent ?? "agent-01", type: "RESULT", body: workerResult.summary, taskId: task.id, files: workerResult.changedFiles });
      emit({ kind: "task", text: `✓ ${task.id} completed by ${worker.id}` });
      return { task, agent: worker, ok: true, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd };
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      const failure: AgentResult = { status: "FAILED", summary: error, changedFiles: [], tests: [] };
      await updateTask(this.workspace, task.id, { status: "failed", result: failure });
      await updateAgent(this.workspace, worker.id, { status: "failed", result: failure, current: "Worker failed and requires recovery.", next: "Inspect the saved state before retrying." });
      await sendMessage(this.workspace, { from: worker.id, to: worker.parent ?? "agent-01", type: "BLOCKED", body: error, taskId: task.id });
      emit({ kind: "error", text: `! ${worker.id} failed: ${error}` });
      return { task, agent: worker, ok: false, error, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
  }

  private roleForTitle(title: string): AgentRole {
    const lower = title.toLowerCase();
    if (lower.includes("research")) return "researcher";
    if (lower.includes("frontend") || lower.includes("user-facing")) return "frontend";
    if (lower.includes("backend") || lower.includes("data")) return "backend";
    if (lower.includes("verify") || lower.includes("test")) return "tester";
    return "builder";
  }
}
