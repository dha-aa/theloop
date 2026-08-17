# Provider Architecture

The Loop now routes model work through a normalized provider contract in `src/providers/interface.ts`. Every provider exposes model discovery, generation, streaming, capability checks, and a stable provider identifier. The registry keeps configured providers available for inspection, while `ModelRouter` applies the selected strategy and records health for retryable failures.

## Supported adapters

| Provider | Adapter | Configuration | Default model behavior |
|---|---|---|---|
| Anthropic | `NormalizedAnthropicProvider` | `ANTHROPIC_API_KEY` | Uses Anthropic model discovery. |
| OpenAI | `OpenAIProvider` | `OPENAI_API_KEY` | Uses OpenAI-compatible `/models` and `/chat/completions`. |
| Gemini | `GeminiProvider` | `GEMINI_API_KEY` | Uses the Gemini REST `generateContent` and streaming endpoints. |
| OpenRouter | `OpenRouterProvider` | `OPENROUTER_API_KEY` | Uses the OpenAI-compatible API with optional site/app headers. |

Provider keys are persisted by `/config <provider> <key>` in `.env` with restrictive file permissions. The values are never printed by `/providers` or `doctor`; status output reports only whether a key is configured.

## Routing strategies

The provider selector supports `auto`, `best`, `fast`, `cheap`, `balanced`, and `custom`. An explicit custom selection is honored even when its model is not in the local discovery cache, allowing providers with private or newly released model identifiers to be used. Retryable provider failures can fall through to another configured provider, while non-retryable failures stop immediately.

The legacy Anthropic agent remains available for compatibility. The routed agent is used for multi-agent workers and provider-aware single tasks, preserving bounded prompts, approvals, terminal confinement, web-search limits, and project-memory injection.

## Deliberate boundaries

The adapters use native `fetch` for OpenAI-compatible and Gemini endpoints to keep the installation small. They do not pretend to provide provider-specific parity for every tool or multimodal feature; unsupported capabilities are reported by the adapter and should be selected through the capability-aware router rather than assumed.
