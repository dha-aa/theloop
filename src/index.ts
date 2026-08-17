import "dotenv/config";
import React from "react";
import { render } from "ink";
import { ClaudeAgent } from "./agent.js";
import { AnthropicProvider } from "./provider/anthropic.js";
import { LoopTui } from "./tui.js";
import { startProjectSession } from "./project-memory.js";
import { createProviderRuntime } from "./providers/runtime.js";
import { handleCliArguments } from "./cli.js";

async function main(): Promise<void> {
  const cli = await handleCliArguments(process.argv.slice(2));
  if (cli.handled) return;
  if (cli.workspace) process.chdir(cli.workspace);
  const workspace = process.cwd();
  const provider = new AnthropicProvider();
  const providerRuntime = createProviderRuntime();
  const session = await startProjectSession(workspace, process.env.THELOOP_GOAL || "Interactive terminal agent session");
  const runtime = { provider, providerRuntime, agent: new ClaudeAgent(provider, "not configured", workspace, session), session, resumed: session.previous !== "(no previous session)" };
  const app = render(React.createElement(LoopTui, { runtime, workspace }), { exitOnCtrlC: true });
  await app.waitUntilExit();
}

await main();
