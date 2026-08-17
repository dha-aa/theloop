import React, { useMemo, useRef, useState } from "react";
import { Box, Newline, Text, useApp, useInput } from "ink";
import type { ApprovalRequest, ClaudeAgent } from "./agent.js";
import { saveApiKey, saveProviderApiKey, type ConfiguredProvider } from "./config.js";
import type { AvailableModel, AnthropicProvider } from "./provider/anthropic.js";
import { createProviderRuntime } from "./providers/runtime.js";
import { RoutedAgent } from "./providers/agent.js";
import type { ModelPolicy } from "./providers/model-router.js";
import { routeLocalCommand } from "./router.js";
import { MultiAgentOrchestrator, type OrchestratorEvent } from "./multi-agent/orchestrator.js";
import { loadAgentState } from "./multi-agent/state.js";
import { finishProjectSession, recordMilestone, type ProjectSession } from "./project-memory.js";

export interface TuiRuntime {
  provider: AnthropicProvider;
  providerRuntime: ReturnType<typeof createProviderRuntime>;
  providerPolicy?: ModelPolicy;
  routedAgent?: RoutedAgent;
  agent: ClaudeAgent;
  selected?: AvailableModel;
  session?: ProjectSession;
  resumed?: boolean;
  orchestrator?: MultiAgentOrchestrator;
}
type Mode = "main" | "model" | "config";
type TuiProps = { runtime: TuiRuntime; workspace: string };
const statusMarker: Record<string, string> = { Ready: "○", Thinking: "○", Building: "●", Done: "✓", Error: "✕", "Needs input": "!" };

export function LoopTui({ runtime, workspace }: TuiProps): React.ReactElement {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("main");
  const [configProvider, setConfigProvider] = useState<ConfiguredProvider>("anthropic");
  const [input, setInput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [assistant, setAssistant] = useState("");
  const [responseLabel, setResponseLabel] = useState("claude");
  const [usage, setUsage] = useState({ input: 0, output: 0, cost: 0 });
  const [status, setStatus] = useState("Ready");
  const [detail, setDetail] = useState(runtime.resumed ? "Previous session loaded. Tell The Loop what you want to build." : "Tell The Loop what you want to build.");
  const [events, setEvents] = useState<string[]>(runtime.resumed ? ["↻ resumed previous session"] : []);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelIndex, setModelIndex] = useState(0);
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const [teamSummary, setTeamSummary] = useState({ agents: 0, tasks: 0, active: 0 });
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<string | undefined>();
  const approvalResolver = useRef<((approved: boolean) => void) | undefined>(undefined);
  const project = useMemo(() => workspace.split(/[\\/]/).pop() || workspace, [workspace]);
  const modelName = runtime.selected?.displayName ?? "model not selected";
  const addEvent = (event: string): void => setEvents((current) => [...current.slice(-5), event]);
  const askApproval = (request: ApprovalRequest): Promise<boolean> => new Promise((resolve) => { approvalResolver.current = resolve; setApproval(`${request.kind === "web_search" ? "Web search" : "Terminal"}: ${request.value}`); });

  const showProviders = async (): Promise<void> => {
    const providers = runtime.providerRuntime.registry.list();
    const health = new Map(runtime.providerRuntime.router.status().map((item) => [item.provider, item]));
    setPrompt("/providers"); setResponseLabel("providers");
    setAssistant(providers.map((provider) => { const item = health.get(provider.id); return (provider.configured ? "●" : "○") + " " + provider.displayName + " (" + provider.id + ") · " + (provider.configured ? "configured" : "not configured") + " · " + (item?.successCount ?? 0) + " successes / " + (item?.failureCount ?? 0) + " failures"; }).join("\n"));
    setDetail("Provider registry and health status."); setStatus("Done");
  };
  const setProviderPolicy = (value: string, command = "/provider"): void => {
    const normalized = value.trim().toLowerCase();
    const strategies = new Set(["auto", "best", "fast", "cheap", "balanced"]);
    const policy: ModelPolicy = strategies.has(normalized) ? { strategy: normalized as ModelPolicy["strategy"] } : { strategy: "auto", provider: normalized };
    runtime.providerPolicy = policy; runtime.routedAgent = undefined; runtime.orchestrator = undefined;
    setPrompt(command + " " + value); setResponseLabel("providers"); setAssistant("Provider policy set to " + normalized + "."); setDetail("Future model calls will use the normalized provider router."); setStatus("Done"); addEvent("✓ provider policy " + normalized);
  };
  const selectCurrentModel = async (): Promise<void> => {
    const selected = models[modelIndex];
    if (!selected) return;
    setBusy(true); setError(""); setStatus("Thinking"); setDetail(`Testing ${selected.displayName}.`);
    try {
      await runtime.provider.testModel(selected.id);
      runtime.selected = selected;
      runtime.agent = new (runtime.agent.constructor as new (provider: AnthropicProvider, modelId: string, workspace: string, session?: ProjectSession) => ClaudeAgent)(runtime.provider, selected.id, workspace, runtime.session);
      runtime.orchestrator = new MultiAgentOrchestrator(runtime.provider, selected.id, workspace, runtime.session);
      setMode("main"); setStatus("Done"); setDetail("Model selected and ready."); addEvent(`✓ selected ${selected.displayName}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught)); setStatus("Error"); setDetail("The model could not be selected.");
    } finally { setBusy(false); }
  };

  const openModelSelector = async (): Promise<void> => {
    setMode("model"); setBusy(true); setStatus("Thinking"); setDetail("Fetching models available to this Anthropic account."); setError("");
    try {
      const available = await runtime.provider.listModels();
      setModels(available);
      const currentIndex = available.findIndex((model) => model.id === runtime.selected?.id);
      setModelIndex(currentIndex >= 0 ? currentIndex : 0); setStatus("Needs input"); setDetail("Choose a model with ↑/↓ and press Enter.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught)); setStatus("Error"); setDetail("Could not load the available models."); setMode("main");
    } finally { setBusy(false); }
  };

  const openConfig = (provider: ConfiguredProvider = "anthropic"): void => { setConfigProvider(provider); setMode("config"); setInput(""); setError(""); setStatus("Needs input"); setDetail("Enter the " + provider + " API key. Input is hidden."); };
  const saveConfig = async (): Promise<void> => {
    if (!input.trim()) return;
    setBusy(true); setStatus("Thinking"); setDetail("Saving the API key and loading available models.");
    try {
      if (configProvider === "anthropic") {
        await saveApiKey(input, workspace);
        runtime.provider = new (runtime.provider.constructor as new (apiKey?: string) => AnthropicProvider)(input);
      } else {
        await saveProviderApiKey(configProvider, input, workspace);
      }
      runtime.providerRuntime = createProviderRuntime();
      setInput(""); await openModelSelector();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught)); setStatus("Error"); setDetail("The API key could not be saved.");
    } finally { setBusy(false); }
  };

  const showAgents = async (): Promise<void> => {
    const snapshot = await loadAgentState(workspace);
    setPrompt("/agents"); setResponseLabel("team"); setAssistant(snapshot.agents.length === 0 ? "No agents recorded." : snapshot.agents.map((agent) => `${agent.status === "done" ? "✓" : agent.status === "failed" || agent.status === "blocked" ? "!" : "●"} ${agent.id}  ${agent.role}  ${agent.status}  ${agent.progress}%\n  ${agent.current}`).join("\n")); setDetail(`${snapshot.agents.length} agents recorded.`); setStatus("Done");
  };
  const showTasks = async (): Promise<void> => {
    const snapshot = await loadAgentState(workspace);
    setPrompt("/tasks"); setResponseLabel("team"); setAssistant(snapshot.tasks.length === 0 ? "No tasks recorded." : snapshot.tasks.map((task) => `${task.status === "done" ? "✓" : task.status === "failed" || task.status === "blocked" ? "!" : task.status === "waiting" ? "○" : "◉"} ${task.id}  ${task.title}  [${task.status}]`).join("\n")); setDetail(`${snapshot.tasks.length} tasks recorded.`); setStatus("Done");
  };
  const runTeam = async (goal: string): Promise<void> => {
    if (!runtime.selected) { setStatus("Needs input"); setDetail("Select a model with /model before starting a team run."); return; }
    runtime.orchestrator ??= runtime.providerPolicy
      ? new MultiAgentOrchestrator(runtime.provider, runtime.selected.id, workspace, runtime.session, runtime.providerRuntime.router, runtime.providerPolicy)
      : new MultiAgentOrchestrator(runtime.provider, runtime.selected.id, workspace, runtime.session);
    setPrompt(goal); setAssistant(""); setResponseLabel("team"); setStatus("Building"); setDetail("Orchestrator is planning specialist work."); setError(""); setBusy(true);
    let streamed = false;
    const emit = (event: OrchestratorEvent): void => { addEvent(`${event.kind === "error" ? "!" : "◉"} ${event.text}`); if (event.kind === "plan") setDetail(event.text); };
    try {
      const result = await runtime.orchestrator.run(goal, askApproval, emit, (chunk) => { streamed = true; setStatus("Building"); setDetail("Worker output streaming..."); setAssistant((current) => current + chunk); });
      if (!streamed) setAssistant(`Orchestration complete. ${result.snapshot.tasks.length} tasks, ${result.snapshot.agents.length} agents.`);
      setUsage({ input: result.inputTokens, output: result.outputTokens, cost: result.costUsd }); setTeamSummary({ agents: result.snapshot.agents.length, tasks: result.snapshot.tasks.length, active: result.snapshot.agents.filter((agent) => agent.status === "working" || agent.status === "verifying" || agent.status === "waiting").length }); setStatus("Done"); setDetail("The orchestrator integrated the worker results."); addEvent("✓ team completed");
      if (runtime.session) await recordMilestone(workspace, { title: "Multi-agent task completed", summary: goal, verification: `${result.snapshot.tasks.length} tasks and ${result.snapshot.agents.length} agents recorded.`, status: "completed" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught); setError(message); setStatus("Error"); setDetail("The team run needs attention."); addEvent(`! team failed: ${message}`);
      if (runtime.session) await recordMilestone(workspace, { title: "Multi-agent task blocked", summary: goal, verification: message, status: "blocked" });
    } finally { setBusy(false); }
  };
  const runTask = async (task: string): Promise<void> => {
    setPrompt(task); setAssistant(""); setResponseLabel("claude"); setStatus("Building"); setDetail("Working through the task."); setError(""); addEvent("◉ working"); setBusy(true);
    let streamed = false;
    try {
      const direct = await routeLocalCommand(task, workspace);
      if (direct) {
        setResponseLabel("direct"); setAssistant(`$ ${direct.command}\n${direct.output}`); setUsage({ input: 0, output: 0, cost: 0 });
        setStatus(direct.exitCode === 0 ? "Done" : "Error"); setDetail(`Direct action: ${direct.label}. No model call.`); addEvent(`✓ direct ${direct.label}`); if (runtime.session) await recordMilestone(workspace, { title: `Direct: ${direct.label}`, summary: `Executed ${direct.command} through the local-first router.`, verification: `Exit code ${direct.exitCode}.`, status: direct.exitCode === 0 ? "completed" : "blocked" }); return;
      }
      const agent = runtime.providerPolicy ? (runtime.routedAgent ??= new RoutedAgent(runtime.providerRuntime.router, workspace, runtime.session, runtime.providerPolicy)) : runtime.agent;
      const result = await agent.run(task, askApproval, (chunk) => { streamed = true; setStatus("Thinking"); setDetail("Streaming Claude response..."); setAssistant((current) => current + chunk); });
      if (!streamed) setAssistant(result.text);
      setUsage({ input: result.inputTokens, output: result.outputTokens, cost: result.costUsd }); setStatus("Done"); setDetail("Ready for the next task."); addEvent("✓ completed"); if (runtime.session) await recordMilestone(workspace, { title: "Claude task completed", summary: task, verification: `${result.inputTokens} input tokens, ${result.outputTokens} output tokens, ${result.toolTurns} tool turns.`, status: "completed" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught)); setStatus("Error"); setDetail("The task needs attention."); if (runtime.session) await recordMilestone(workspace, { title: "Task blocked", summary: task, verification: caught instanceof Error ? caught.message : String(caught), status: "blocked" });
    } finally { setBusy(false); }
  };
  useInput((value, key) => {
    if (key.ctrl && value === "c") { exit(); return; }
    if (approval) {
      if (value.toLowerCase() === "y") { approvalResolver.current?.(true); approvalResolver.current = undefined; setApproval(undefined); }
      else if (value.toLowerCase() === "n" || key.escape) { approvalResolver.current?.(false); approvalResolver.current = undefined; setApproval(undefined); }
      return;
    }
    if (mode === "model") {
      if (key.upArrow) setModelIndex((index) => Math.max(0, index - 1));
      else if (key.downArrow) setModelIndex((index) => Math.min(models.length - 1, index + 1));
      else if (key.return && !busy) void selectCurrentModel();
      else if (key.escape) { setMode("main"); setStatus("Ready"); setDetail("Tell The Loop what you want to build."); }
      return;
    }
    if (mode === "config") {
      if (key.return && !busy) void saveConfig();
      else if (key.escape) { setMode("main"); setStatus("Ready"); setDetail("Tell The Loop what you want to build."); setInput(""); }
      else if (key.backspace) setInput((current) => current.slice(0, -1));
      else if (!key.ctrl && !key.meta && value) setInput((current) => current + value);
      return;
    }
    if (key.tab) { setDetails((current) => !current); return; }
    if (key.escape) { setStatus("Ready"); setDetail("Paused. Press Enter to send a task."); addEvent("! paused"); return; }
    if (key.ctrl && value === "z") { addEvent("↶ rollback is not available yet"); return; }
    if (key.return && !busy) {
      const task = input.trim(); setInput(""); if (!task) return;
      if (task === "/exit" || task === "/quit") { if (runtime.session) { void finishProjectSession(workspace, runtime.session, "Completed", "Session closed from the TUI.").finally(exit); } else exit(); return; }
      if (task === "/model") { void openModelSelector(); return; }
      if (task === "/config") { openConfig(); return; }
      if (task.startsWith("/config ")) { openConfig(task.slice(8).trim() as ConfiguredProvider); return; }
      if (task === "/clear") { runtime.agent.clear(); setPrompt(""); setAssistant(""); setEvents([]); setStatus("Ready"); setDetail("Context cleared."); return; }
      if (task === "/compact") { runtime.agent.compact(); addEvent("✓ context compacted"); return; }
      if (task === "/agents") { void showAgents(); return; }
      if (task === "/providers") { void showProviders(); return; }
      if (task.startsWith("/provider ")) { setProviderPolicy(task.slice(10), "/provider"); return; }
      if (task.startsWith("/strategy ")) { setProviderPolicy(task.slice(10), "/strategy"); return; }
      if (task === "/tasks") { void showTasks(); return; }
      if (task.startsWith("/team ")) { const goal = task.slice(6).trim(); if (goal) void runTeam(goal); return; }
      if (task === "/details") { setDetails((current) => !current); return; }
      void runTask(task); return;
    }
    if (key.backspace) setInput((current) => current.slice(0, -1));
    else if (!key.ctrl && !key.meta && value) setInput((current) => current + value);
  });

  return <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
    <Box justifyContent="space-between"><Text bold color="cyan">The Loop terminal agent</Text><Text dimColor>{project} {runtime.selected ? "●" : "○"}</Text></Box>
    <Box borderStyle="single" borderColor="gray" flexDirection="column" marginTop={1} paddingX={1}>
      {mode === "model" ? <><Text bold>Choose a Claude model</Text><Newline />{models.map((model, index) => <Text key={model.id} color={index === modelIndex ? "cyan" : undefined}>{index === modelIndex ? "❯ " : "  "}{model.displayName} <Text dimColor>({model.id})</Text></Text>)}</> : mode === "config" ? <><Text bold>Configure {configProvider}</Text><Newline /><Text>API key: {"*".repeat(input.length)}▌</Text><Text dimColor>Enter save   Esc cancel</Text></> : <><Text>{prompt || "What do you want to build?"}</Text><Newline /><Text color={status === "Error" ? "red" : status === "Done" ? "green" : "cyan"}>{statusMarker[status] ?? "●"} {status}</Text><Text dimColor>{detail}</Text>{events.slice(-4).map((event, index) => <Text key={`${index}-${event}`}>{event}</Text>)}{assistant ? <><Newline /><Text color="green">{responseLabel}: {assistant}</Text></> : null}{error ? <Text color="red">! {error}</Text> : null}{details ? <><Newline /><Text bold>Details</Text><Text dimColor>Model: {modelName}</Text><Text dimColor>Workspace: {workspace}</Text><Text dimColor>Events: {events.length}</Text><Text dimColor>Team: {teamSummary.active}/{teamSummary.agents} active · {teamSummary.tasks} tasks</Text></> : null}</>}
    </Box>
    {approval ? <Box borderStyle="single" borderColor="yellow" flexDirection="column" marginTop={1} paddingX={1}><Text color="yellow" bold>Approval required</Text><Text>{approval}</Text><Text dimColor>Press y to approve or n/Esc to cancel.</Text></Box> : null}
    <Box marginTop={1} justifyContent="space-between">
      <Text dimColor>Enter send   Tab details   Esc stop   Ctrl+Z undo   /model   /config [provider]   /provider   /strategy   /providers   /team   /agents   /tasks</Text>
      <Text dimColor>tokens {usage.input.toLocaleString()} in / {usage.output.toLocaleString()} out · est. ${usage.cost.toFixed(4)}</Text>
    </Box>
    <Box><Text color="cyan">&gt; </Text><Text>{mode === "config" ? "*".repeat(input.length) : input}▌</Text></Box>
  </Box>;
}
