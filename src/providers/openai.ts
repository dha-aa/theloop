import { OpenAICompatibleProvider } from "./openai-compatible.js";
export class OpenAIProvider extends OpenAICompatibleProvider { public constructor(apiKey = process.env.OPENAI_API_KEY, baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1") { super({ id: "openai", displayName: "OpenAI", apiKey, baseUrl, defaultModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini" }); } }
