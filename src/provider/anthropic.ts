import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "../config.js";
import { anthropicWebSearchTool } from "../tools/definitions.js";

export interface AvailableModel { id: string; displayName: string; createdAt: string; maxInputTokens: number | null; maxTokens: number | null; }
export interface ModelTestResult { modelId: string; response: string; }
export type MessageStream = ReturnType<Anthropic["messages"]["stream"]>;

export class AnthropicProvider {
  private client: Anthropic | undefined;
  public constructor(apiKey = getApiKey()) { if (apiKey) this.client = new Anthropic({ apiKey }); }
  public setApiKey(apiKey: string): void { this.client = new Anthropic({ apiKey }); }
  private requireClient(): Anthropic { if (!this.client) throw new Error("Anthropic API key is missing. Use /config first."); return this.client; }
  public async listModels(): Promise<AvailableModel[]> {
    const models: AvailableModel[] = [];
    for await (const model of this.requireClient().models.list({ limit: 100 })) models.push({ id: model.id, displayName: model.display_name, createdAt: model.created_at, maxInputTokens: model.max_input_tokens, maxTokens: model.max_tokens });
    return models;
  }
  public async testModel(modelId: string): Promise<ModelTestResult> {
    const message = await this.createMessage({ model: modelId, max_tokens: 8, messages: [{ role: "user", content: "Reply exactly OK" }] });
    return { modelId, response: extractText(message.content) };
  }
  public async createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> { return this.requireClient().messages.create(params); }
  public streamMessage(params: Anthropic.MessageCreateParamsNonStreaming): MessageStream { return this.requireClient().messages.stream(params); }
  public async searchWeb(modelId: string, query: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const message = await this.createMessage({ model: modelId, max_tokens: 512, tools: [anthropicWebSearchTool], messages: [{ role: "user", content: `Search the web for: ${query}\nReturn concise cited findings.` }] });
    return { text: extractText(message.content) || "The web search returned no text.", inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  }
}

export function extractText(content: Anthropic.ContentBlock[]): string { return content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("\n").trim(); }
