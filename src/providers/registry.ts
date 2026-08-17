import type { LLMProvider } from "./interface.js";
import type { ModelCapability, ProviderId, ProviderModel } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LLMProvider>();

  public register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  public unregister(id: ProviderId): boolean {
    return this.providers.delete(id);
  }

  public get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  public require(id: ProviderId): LLMProvider {
    const provider = this.get(id);
    if (!provider) throw new Error(`Provider is not registered: ${id}`);
    return provider;
  }

  public list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  public configured(): LLMProvider[] {
    return this.list().filter((provider) => provider.configured);
  }

  public async listModels(): Promise<ProviderModel[]> {
    const results = await Promise.all(
      this.configured().map(async (provider) => provider.listModels()),
    );
    return results.flat();
  }

  public findCapable(capability: ModelCapability): LLMProvider[] {
    return this.configured().filter((provider) => provider.supports(capability));
  }
}
