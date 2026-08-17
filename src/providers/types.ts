export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | (string & {});

export type ModelCapability =
  | "coding"
  | "strong-reasoning"
  | "reasoning"
  | "research"
  | "fast"
  | "tools"
  | "vision"
  | "structured-output"
  | "streaming";

export interface ProviderModel {
  id: string;
  provider: ProviderId;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities: ModelCapability[];
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMContentBlock {
  type: "text" | "tool_call" | "tool_result";
  text?: string;
  toolCall?: NormalizedToolCall;
  toolResult?: { toolCallId: string; content: string; isError?: boolean };
}

export interface LLMMessage {
  role: LLMRole;
  content: string | LLMContentBlock[];
  name?: string;
  toolCallId?: string;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMRequest {
  model?: string;
  system?: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

export type FinishReason = "stop" | "tool_use" | "length" | "error" | "unknown";

export interface LLMResponse {
  content: LLMContentBlock[];
  toolCalls: NormalizedToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  provider: ProviderId;
  model: string;
  requestId?: string;
}

export type LLMStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: NormalizedToolCall }
  | { type: "tool_delta"; toolId: string; delta: string }
  | { type: "tool_end"; toolId: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; reason: FinishReason }
  | { type: "error"; error: ProviderError };

export interface ProviderErrorShape {
  code?: string;
  retryable: boolean;
  status?: number;
  provider: ProviderId;
}

export class ProviderError extends Error implements ProviderErrorShape {
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly provider: ProviderId;
  public readonly code?: string;

  public constructor(message: string, shape: ProviderErrorShape) {
    super(message);
    this.name = "ProviderError";
    this.retryable = shape.retryable;
    this.status = shape.status;
    this.provider = shape.provider;
    this.code = shape.code;
  }
}
