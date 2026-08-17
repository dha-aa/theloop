import type Anthropic from "@anthropic-ai/sdk";

export const terminalTool: Anthropic.Tool = {
  name: "terminal",
  description: "Run one project-local shell command after user approval. Use for inspection, builds, and tests; never access secrets or system paths.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string", description: "One project-local shell command." } },
    required: ["command"],
    additionalProperties: false,
  },
};

// Client-side wrapper: the agent asks the user before the provider invokes Anthropic web search.
export const webSearchTool: Anthropic.Tool = {
  name: "web_search",
  description: "Search the public web for current information after user approval. Return concise cited findings.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "A focused public-web search query." } },
    required: ["query"],
    additionalProperties: false,
  },
};

// Anthropic executes this server tool only after the client has approved the wrapper call.
export const anthropicWebSearchTool: Anthropic.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
};

export const toolSummary = [
  { name: "terminal", kind: "client", description: "Approved project-local commands." },
  { name: "web_search", kind: "client + Anthropic", description: "Approved cited live search; max 3 searches." },
] as const;
