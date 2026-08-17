import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider as LegacyAnthropicProvider } from "../provider/anthropic.js";
import type { LLMProvider } from "./interface.js";
import {
  ProviderError,
  type LLMContentBlock,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamEvent,
  type ModelCapability,
  type ProviderModel,
  type TokenUsage,
} from "./types.js";

function toMessages(request: LLMRequest): Anthropic.MessageParam[] {
  return request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((block) => block.type === "text")
              .map((block) => block.text ?? "")
              .join("\n"),
    }));
}

function usageOf(value: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.input_tokens + value.output_tokens,
  };
}

export class NormalizedAnthropicProvider implements LLMProvider {
  public readonly id = "anthropic" as const;
  public readonly displayName = "Anthropic";
  private readonly legacy: LegacyAnthropicProvider;
  private readonly apiKey?: string;

  public constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    this.apiKey = apiKey;
    this.legacy = new LegacyAnthropicProvider(apiKey);
  }

  public get configured(): boolean {
    return Boolean(this.apiKey);
  }

  public async listModels(): Promise<ProviderModel[]> {
    try {
      const models = await this.legacy.listModels();
      return models.map((model) => ({
        id: model.id,
        provider: this.id,
        displayName: model.displayName,
        contextWindow: model.maxInputTokens ?? undefined,
        maxOutputTokens: model.maxTokens ?? undefined,
        capabilities: [
          "coding",
          "strong-reasoning",
          "reasoning",
          "research",
          "tools",
          "streaming",
          "structured-output",
        ],
      }));
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : String(error), {
        provider: this.id,
        retryable: false,
      });
    }
  }

  private params(request: LLMRequest): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: request.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: request.maxOutputTokens ?? 1024,
      ...(request.system ? { system: request.system } : {}),
      messages: toMessages(request),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: { type: "object", ...tool.inputSchema },
            })),
          }
        : {}),
    };
  }

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.configured) {
      throw new ProviderError("Anthropic API key is missing.", {
        provider: this.id,
        retryable: false,
        code: "missing_api_key",
      });
    }
    const message = await this.legacy.createMessage(this.params(request));
    const content: LLMContentBlock[] = [];
    const toolCalls: LLMResponse["toolCalls"] = [];
    for (const block of message.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      if (block.type === "tool_use") {
        const call = {
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        };
        toolCalls.push(call);
        content.push({ type: "tool_call", toolCall: call });
      }
    }
    return {
      content,
      toolCalls,
      usage: usageOf(message.usage),
      finishReason:
        message.stop_reason === "tool_use"
          ? "tool_use"
          : message.stop_reason === "max_tokens"
            ? "length"
            : "stop",
      provider: this.id,
      model: message.model,
      requestId: message.id,
    };
  }

  public async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    if (!this.configured) {
      yield {
        type: "error",
        error: new ProviderError("Anthropic API key is missing.", {
          provider: this.id,
          retryable: false,
          code: "missing_api_key",
        }),
      };
      return;
    }
    const stream = this.legacy.streamMessage(this.params(request)) as AsyncIterable<any>;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let reason: LLMResponse["finishReason"] = "stop";
    for await (const event of stream) {
      if (event.type === "message_start" && event.message?.usage) {
        usage = usageOf(event.message.usage);
      }
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        yield {
          type: "tool_start",
          tool: {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: {},
          },
        };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
      if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
        yield {
          type: "tool_delta",
          toolId: event.index?.toString() ?? "tool",
          delta: event.delta.partial_json,
        };
      }
      if (event.type === "message_delta") {
        if (event.usage) {
          usage = {
            ...usage,
            outputTokens: event.usage.output_tokens,
            totalTokens: usage.inputTokens + event.usage.output_tokens,
          };
        }
        if (event.delta?.stop_reason === "tool_use") reason = "tool_use";
        if (event.delta?.stop_reason === "max_tokens") reason = "length";
      }
    }
    yield { type: "usage", usage };
    yield { type: "done", reason };
  }

  public supports(capability: ModelCapability): boolean {
    return [
      "coding",
      "strong-reasoning",
      "reasoning",
      "research",
      "tools",
      "streaming",
      "structured-output",
    ].includes(capability);
  }
}
