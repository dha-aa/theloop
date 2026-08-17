export type AgentRole =
  | "orchestrator"
  | "researcher"
  | "builder"
  | "frontend"
  | "backend"
  | "database"
  | "tester"
  | "browser"
  | "reviewer"
  | "debugger"
  | "documentation";

export type AgentStatus =
  | "created"
  | "assigned"
  | "working"
  | "verifying"
  | "done"
  | "blocked"
  | "waiting"
  | "failed"
  | "cancelled";

export type TaskStatus =
  | "pending"
  | "ready"
  | "working"
  | "verifying"
  | "done"
  | "blocked"
  | "waiting"
  | "failed"
  | "cancelled";

export type TaskPriority = "low" | "normal" | "high" | "critical";

export type MessageType =
  | "INFO"
  | "QUESTION"
  | "REQUEST"
  | "BLOCKED"
  | "CONTRACT"
  | "RESULT"
  | "WARNING"
  | "CONFLICT";

export interface AgentResult {
  status: "DONE" | "BLOCKED" | "FAILED" | "CANCELLED";
  summary: string;
  changedFiles: string[];
  tests: string[];
  contract?: string;
  notes?: string;
  followUp?: string;
}

export interface AgentBudget {
  maxTokens?: number;
  maxToolCalls?: number;
  maxRuntimeMs?: number;
  maxCostUsd?: number;
}
export interface AgentRecord {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  taskId?: string;
  task: string;
  workspace: string;
  parent?: string;
  progress: number;
  files: string[];
  dependsOn: string[];
  current: string;
  next: string;
  result?: AgentResult;
  checkpoint?: string;
  depth?: number;
  retries?: number;
  budget?: AgentBudget;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  owner?: string;
  status: TaskStatus;
  priority: TaskPriority;
  files: string[];
  verification: string[];
  result?: AgentResult;
  checkpoint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  body: string;
  taskId?: string;
  files?: string[];
  createdAt: string;
  acknowledgedAt?: string;
}

export interface OrchestrationPlan {
  goal: string;
  rationale: string;
  tasks: AgentTask[];
  parallelGroups: string[][];
  createdAt: string;
  source: "model" | "fallback";
}

export interface AgentStateSnapshot {
  agents: AgentRecord[];
  tasks: AgentTask[];
  messages: AgentMessage[];
  plan?: OrchestrationPlan;
}



export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

export function isActiveAgentStatus(status: AgentStatus): boolean {
  return status === "working" || status === "verifying" || status === "waiting";
}
