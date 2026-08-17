import { loadTheLoopMemory, formatTheLoopContext, type ProjectSession } from "../project-memory.js";
import { runTerminal } from "../tools/terminal.js";
import type { ApprovalPrompt, AgentRunResult, TextSink } from "../agent.js";
import { ModelRouter, type ModelPolicy } from "./model-router.js";
import type { LLMContentBlock, LLMMessage, NormalizedToolCall } from "./types.js";

const MAX_HISTORY_MESSAGES = 16;
const MAX_TOOL_TURNS = 4;
const TOOL_DEFINITIONS = [
  { name: "terminal", description: "Run one project-local shell command after user approval.", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } },
  { name: "web_search", description: "Search the public web after user approval.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
];

function textFrom(blocks: LLMContentBlock[]): string { return blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim(); }
function cost(model: string, inputTokens: number, outputTokens: number): number { const lower = model.toLowerCase(); const inputRate = lower.includes("haiku") ? 1 : lower.includes("sonnet") ? 3 : lower.includes("opus") ? 5 : 0; const outputRate = lower.includes("haiku") ? 5 : lower.includes("sonnet") ? 15 : lower.includes("opus") ? 25 : 0; return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000; }

export class RoutedAgent {
  private messages: LLMMessage[] = [];
  private projectMemory = "";
  public constructor(private readonly router: ModelRouter, private readonly workspace: string, private readonly session?: ProjectSession, private readonly policy: ModelPolicy = { strategy: "auto" }) {}
  public clear(): void { this.messages = []; }
  public compact(): void { this.trimHistory(6); }
  public historySize(): number { return this.messages.length; }
  public async run(prompt: string, approve: ApprovalPrompt, onText: TextSink = () => undefined): Promise<AgentRunResult> {
    const memory = await loadTheLoopMemory(this.workspace, this.session);
    this.projectMemory = formatTheLoopContext(memory);
    this.trimHistory(MAX_HISTORY_MESSAGES);
    this.messages.push({ role: "user", content: prompt });
    let inputTokens = 0;
    let outputTokens = 0;
    let toolTurns = 0;
    let finalText = "";
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const blocks: LLMContentBlock[] = [];
      const calls = new Map<string, NormalizedToolCall & { rawArguments: string }>();
      let model = "unknown";
      for await (const event of this.router.stream({ system: this.projectMemory, messages: this.messages, tools: TOOL_DEFINITIONS, maxOutputTokens: 1024 }, this.policy)) {
        if (event.type === "text") { blocks.push({ type: "text", text: event.text }); onText(event.text); }
        if (event.type === "tool_start") { calls.set(event.tool.id, { ...event.tool, rawArguments: "" }); }
        if (event.type === "tool_delta") { const call = calls.get(event.toolId); if (call) call.rawArguments += event.delta; }
        if (event.type === "usage") { inputTokens += event.usage.inputTokens; outputTokens += event.usage.outputTokens; }
        if (event.type === "done") { /* The provider owns the exact finish reason. */ }
      }
      const toolCalls = [...calls.values()].map((call) => { let args = call.arguments; try { args = JSON.parse(call.rawArguments || "{}"); } catch { /* keep the provider's empty arguments */ } return { id: call.id, name: call.name, arguments: args }; });
      for (const call of toolCalls) blocks.push({ type: "tool_call", toolCall: call });
      this.messages.push({ role: "assistant", content: blocks });
      this.trimHistory(MAX_HISTORY_MESSAGES);
      finalText = textFrom(blocks);
      if (toolCalls.length === 0) return { text: finalText || "The model returned no text.", inputTokens, outputTokens, toolTurns, costUsd: cost(model, inputTokens, outputTokens) };
      toolTurns += 1;
      const results: LLMContentBlock[] = [];
      for (const call of toolCalls) {
        if (call.name === "terminal") {
          const command = typeof call.arguments.command === "string" ? call.arguments.command : "";
          const result = await runTerminal(command, this.workspace, () => approve({ kind: "terminal", value: command }));
          results.push({ type: "tool_result", toolResult: { toolCallId: call.id, content: result.output, isError: result.exitCode !== 0 } });
        } else {
          const query = typeof call.arguments.query === "string" ? call.arguments.query : "";
          const approved = await approve({ kind: "web_search", value: query });
          results.push({ type: "tool_result", toolResult: { toolCallId: call.id, content: approved ? "Web search is not configured for this provider adapter. Use a provider with native search support or the legacy Anthropic session." : "User denied the web search.", isError: true } });
        }
      }
      this.messages.push({ role: "tool", content: results });
      this.trimHistory(MAX_HISTORY_MESSAGES);
    }
    return { text: "Stopped after the tool-turn limit.", inputTokens, outputTokens, toolTurns, costUsd: cost("unknown", inputTokens, outputTokens) };
  }
  private trimHistory(limit: number): void { if (this.messages.length <= limit) return; let start = this.messages.length - limit; if (this.messages[start]?.role !== "user") start += 1; this.messages = this.messages.slice(start); }
}
