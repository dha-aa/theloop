import assert from "node:assert/strict";
import { GeminiProvider } from "../src/providers/gemini.js";
import { ModelRouter } from "../src/providers/model-router.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OpenRouterProvider } from "../src/providers/openrouter.js";
import { NormalizedAnthropicProvider } from "../src/providers/anthropic.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { LLMProvider } from "../src/providers/interface.js";
import type { LLMRequest, LLMResponse, LLMStreamEvent, ModelCapability, ProviderModel } from "../src/providers/types.js";

const registry = new ProviderRegistry();
const providers = [
  new NormalizedAnthropicProvider("test-anthropic-key"),
  new OpenAIProvider("test-openai-key"),
  new GeminiProvider("test-gemini-key"),
  new OpenRouterProvider("test-openrouter-key"),
];
for (const provider of providers) registry.register(provider);
assert.deepEqual(registry.list().map((provider) => provider.id), ["anthropic", "openai", "gemini", "openrouter"]);
assert.equal(registry.configured().length, 4);
assert.equal(registry.require("openai").displayName, "OpenAI");
assert.equal(registry.findCapable("streaming").length, 4);
assert.equal(registry.unregister("openrouter"), true);
assert.equal(registry.get("openrouter"), undefined);

const fixture = (id: "openai" | "anthropic", modelId: string, price: number): LLMProvider => {
  const model: ProviderModel = { id: modelId, provider: id, displayName: modelId, capabilities: ["coding", "streaming"], inputPricePerMillion: price, outputPricePerMillion: price };
  return {
    id,
    displayName: id,
    configured: true,
    listModels: async () => [model],
    generate: async (_request: LLMRequest): Promise<LLMResponse> => ({ content: [], toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, finishReason: "stop", provider: id, model: modelId }),
    stream: async function* (_request: LLMRequest): AsyncIterable<LLMStreamEvent> { yield { type: "done", reason: "stop" }; },
    supports: (capability: ModelCapability) => model.capabilities.includes(capability),
  };
};
const router = new ModelRouter([fixture("openai", "gpt-cheap", 1), fixture("anthropic", "claude-strong", 10)], "");
const resolved = await router.resolve({ strategy: "cheap" });
assert.equal(resolved.policy.strategy, "cheap");
assert.equal(resolved.model.id, "gpt-cheap");
const custom = await router.resolve({ strategy: "custom", provider: "openai", model: "gpt-test" });
assert.equal(custom.provider.id, "openai");
assert.equal(custom.model.id, "gpt-test");
console.log("provider registry and routing checks passed");
