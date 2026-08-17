import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicProvider } from "./provider/anthropic.js";
import { extractText } from "./provider/anthropic.js";
import { terminalTool, webSearchTool } from "./tools/definitions.js";
import { runTerminal } from "./tools/terminal.js";
import { loadTheLoopMemory, formatTheLoopContext, type ProjectSession } from "./project-memory.js";

const MAX_HISTORY_MESSAGES = 16;
const MAX_TOOL_TURNS = 4;

export type ApprovalRequest = { kind: "terminal" | "web_search"; value: string };
export type ApprovalPrompt = (request: ApprovalRequest) => Promise<boolean>;
export type TextSink = (text: string) => void;

export interface AgentRunResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolTurns: number;
  costUsd: number;
}

export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const lower = modelId.toLowerCase();
  const inputRate = lower.includes("haiku") ? 1 : lower.includes("sonnet") ? 3 : lower.includes("opus") ? 5 : 0;
  const outputRate = lower.includes("haiku") ? 5 : lower.includes("sonnet") ? 15 : lower.includes("opus") ? 25 : 0;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

export class ClaudeAgent {
  private messages: Anthropic.MessageParam[] = [];
  private projectMemory = "";
  public constructor(private readonly provider: AnthropicProvider, private readonly modelId: string, private readonly workspace: string, private readonly session?: ProjectSession) {}
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
      const stream = this.provider.streamMessage({ model: this.modelId, max_tokens: 1024, system: this.projectMemory, messages: this.messages, tools: [terminalTool, webSearchTool] });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
      }
      const response = await stream.finalMessage();
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      this.messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
      this.trimHistory(MAX_HISTORY_MESSAGES);
      finalText = extractText(response.content);
      const calls = response.content.filter((block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock => block.type === "tool_use" && (block.name === "terminal" || block.name === "web_search"));
      if (calls.length === 0) return this.result(finalText || "Claude returned no text.", inputTokens, outputTokens, toolTurns);

      toolTurns += 1;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = call.input as { command?: unknown; query?: unknown };
        if (call.name === "terminal") {
          const command = typeof input.command === "string" ? input.command : "";
          const result = await runTerminal(command, this.workspace, () => approve({ kind: "terminal", value: command }));
          results.push({ type: "tool_result", tool_use_id: call.id, content: result.output, is_error: result.exitCode !== 0 });
        } else {
          const query = typeof input.query === "string" ? input.query : "";
          if (!(await approve({ kind: "web_search", value: query }))) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "User denied the web search.", is_error: true });
            continue;
          }
          const search = await this.provider.searchWeb(this.modelId, query);
          inputTokens += search.inputTokens;
          outputTokens += search.outputTokens;
          results.push({ type: "tool_result", tool_use_id: call.id, content: search.text });
        }
      }
      this.messages.push({ role: "user", content: results });
      this.trimHistory(MAX_HISTORY_MESSAGES);
    }
    return this.result("Stopped after the tool-turn limit.", inputTokens, outputTokens, toolTurns);
  }

  private result(text: string, inputTokens: number, outputTokens: number, toolTurns: number): AgentRunResult {
    return { text, inputTokens, outputTokens, toolTurns, costUsd: estimateCostUsd(this.modelId, inputTokens, outputTokens) };
  }
  private trimHistory(limit: number): void {
    if (this.messages.length <= limit) return;
    let start = this.messages.length - limit;
    if (this.messages[start]?.role !== "user") start += 1;
    this.messages = this.messages.slice(start);
  }
}
