import type {
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelCapability,
  ProviderId,
  ProviderModel,
} from "./types.js";

export interface LLMProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly configured: boolean;

  listModels(): Promise<ProviderModel[]>;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
  supports(capability: ModelCapability, model?: string): boolean;
}
