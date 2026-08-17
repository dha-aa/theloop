import "dotenv/config";
import { NormalizedAnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";
import { ProviderRegistry } from "./registry.js";
import { ModelRouter } from "./model-router.js";

export function createProviderRuntime(): { registry: ProviderRegistry; router: ModelRouter } {
  const registry = new ProviderRegistry();
  registry.register(new NormalizedAnthropicProvider());
  registry.register(new OpenAIProvider());
  registry.register(new GeminiProvider());
  registry.register(new OpenRouterProvider());
  return { registry, router: new ModelRouter(registry.list(), process.env.LOOP_MODEL) };
}
