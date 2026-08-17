import type { LLMProvider } from "./interface.js";
import { ProviderError } from "./types.js";
import type { LLMRequest, LLMResponse, LLMStreamEvent, ModelCapability, ProviderId, ProviderModel } from "./types.js";

export type ModelStrategy = "auto" | "best" | "fast" | "cheap" | "balanced" | "custom";
export interface ModelPolicy { strategy: ModelStrategy; capability?: ModelCapability; provider?: ProviderId; model?: string; }
export interface ProviderHealth { provider: ProviderId; successCount: number; failureCount: number; lastFailureAt?: string; cooldownUntil?: string; }
export interface ResolvedModel { provider: LLMProvider; model: ProviderModel; policy: ModelPolicy; }

function price(model: ProviderModel): number { return (model.inputPricePerMillion ?? 0) + (model.outputPricePerMillion ?? 0); }
function score(model: ProviderModel, policy: ModelPolicy, health?: ProviderHealth): number {
  const cooldownPenalty = health?.cooldownUntil && Date.parse(health.cooldownUntil) > Date.now() ? -100_000 : 0;
  const capabilityBonus = policy.capability && model.capabilities.includes(policy.capability) ? 100 : 0;
  if (policy.strategy === "cheap") return -price(model) + capabilityBonus + cooldownPenalty;
  if (policy.strategy === "fast") return (model.capabilities.includes("fast") ? 100 : 0) - (model.contextWindow ?? 0) / 1_000_000 + cooldownPenalty;
  if (policy.strategy === "best") return (model.capabilities.includes("strong-reasoning") ? 100 : 0) + (model.maxOutputTokens ?? 0) / 1_000 + cooldownPenalty;
  if (policy.strategy === "balanced") return capabilityBonus + (model.contextWindow ?? 0) / 1_000_000 - price(model) + cooldownPenalty;
  return capabilityBonus + (health?.successCount ?? 0) - (health?.failureCount ?? 0) + cooldownPenalty;
}

export class ModelRouter {
  private readonly health = new Map<ProviderId, ProviderHealth>();
  private modelCache: ProviderModel[] | undefined;
  public constructor(private readonly providers: LLMProvider[], private readonly defaultModel?: string) {}
  public async models(forceRefresh = false): Promise<ProviderModel[]> {
    if (!forceRefresh && this.modelCache) return this.modelCache;
    const results = await Promise.allSettled(this.providers.filter((provider) => provider.configured).map((provider) => provider.listModels()));
    this.modelCache = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    return this.modelCache;
  }
  public status(): ProviderHealth[] { return this.providers.map((provider) => this.health.get(provider.id) ?? { provider: provider.id, successCount: 0, failureCount: 0 }); }
  public async resolve(policy: ModelPolicy = { strategy: "auto" }): Promise<ResolvedModel> {
    if (policy.strategy === "custom" && policy.provider && policy.model) {
      const provider = this.providers.find((item) => item.id === policy.provider && item.configured);
      if (!provider) throw new ProviderError(`Provider is not configured: ${policy.provider}`, { provider: policy.provider, retryable: false, code: "provider_not_configured" });
      return { provider, model: { id: policy.model, provider: provider.id, displayName: policy.model, capabilities: ["coding", "reasoning", "streaming"] }, policy };
    }
    const models = await this.models();
    const eligible = models.filter((model) => (!policy.provider || model.provider === policy.provider) && (!policy.model || model.id === policy.model) && (!policy.capability || model.capabilities.includes(policy.capability)));
    const candidates = eligible.length ? eligible : models.filter((model) => !policy.provider || model.provider === policy.provider);
    const chosen = [...candidates].sort((a, b) => score(b, policy, this.health.get(b.provider)) - score(a, policy, this.health.get(a.provider)))[0];
    if (!chosen) {
      if (this.defaultModel) {
        const provider = this.providers.find((item) => item.configured);
        if (provider) return { provider, model: { id: this.defaultModel, provider: provider.id, displayName: this.defaultModel, capabilities: ["coding", "reasoning", "streaming"] }, policy };
      }
      throw new ProviderError("No configured provider/model matches the requested policy.", { provider: "router", retryable: false, code: "no_model" });
    }
    const provider = this.providers.find((item) => item.id === chosen.provider);
    if (!provider) throw new ProviderError(`Provider is unavailable: ${chosen.provider}`, { provider: chosen.provider, retryable: false });
    return { provider, model: chosen, policy };
  }
  public async generate(request: LLMRequest, policy: ModelPolicy = { strategy: "auto" }): Promise<LLMResponse> {
    const attempted = new Set<ProviderId>();
    let lastError: unknown;
    for (let index = 0; index < this.providers.length; index += 1) {
      const resolved = await this.resolveWithFallback(policy, attempted);
      attempted.add(resolved.provider.id);
      try {
        const result = await resolved.provider.generate({ ...request, model: resolved.model.id });
        this.recordSuccess(resolved.provider.id);
        return result;
      } catch (error) {
        lastError = error;
        this.recordFailure(resolved.provider.id, error);
        if (!(error instanceof ProviderError) || !error.retryable) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  public async *stream(request: LLMRequest, policy: ModelPolicy = { strategy: "auto" }): AsyncIterable<LLMStreamEvent> {
    const resolved = await this.resolve(policy);
    try {
      for await (const event of resolved.provider.stream({ ...request, model: resolved.model.id })) {
        if (event.type === "error") this.recordFailure(resolved.provider.id, event.error);
        else if (event.type === "done") this.recordSuccess(resolved.provider.id);
        yield event;
      }
    } catch (error) {
      this.recordFailure(resolved.provider.id, error);
      throw error;
    }
  }
  private async resolveWithFallback(policy: ModelPolicy, attempted: Set<ProviderId>): Promise<ResolvedModel> {
    const resolved = await this.resolve(policy);
    if (!attempted.has(resolved.provider.id)) return resolved;
    const alternatives = this.providers.filter((provider) => provider.configured && !attempted.has(provider.id));
    for (const provider of alternatives) {
      const models = await provider.listModels().catch(() => []);
      const model = models.find((item) => !policy.capability || item.capabilities.includes(policy.capability));
      if (model) return { provider, model, policy };
    }
    throw new ProviderError("All configured providers have been attempted.", { provider: "router", retryable: false, code: "providers_exhausted" });
  }
  private recordSuccess(provider: ProviderId): void { const current = this.health.get(provider) ?? { provider, successCount: 0, failureCount: 0 }; this.health.set(provider, { ...current, successCount: current.successCount + 1, cooldownUntil: undefined }); }
  private recordFailure(provider: ProviderId, error: unknown): void { const current = this.health.get(provider) ?? { provider, successCount: 0, failureCount: 0 }; const retryable = error instanceof ProviderError ? error.retryable : false; this.health.set(provider, { ...current, failureCount: current.failureCount + 1, lastFailureAt: new Date().toISOString(), cooldownUntil: retryable ? new Date(Date.now() + 30_000).toISOString() : undefined }); }
}
