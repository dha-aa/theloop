import path from "node:path";
const useColor = !process.env.NO_COLOR;
const ansi = { reset: "\x1b[0m", bold: "\x1b[1m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m", red: "\x1b[31m" };
const BOX_WIDTH = 61;
function paint(code: string, text: string): string { return useColor ? `${code}${text}${ansi.reset}` : text; }
function fit(text: string, width = BOX_WIDTH - 2): string { return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width); }
function row(text = ""): string { return `│ ${fit(text)} │`; }
function divider(): string { return `├${"─".repeat(BOX_WIDTH)}┤`; }
export interface TuiState { model: string; workspace: string; prompt?: string; assistant?: string; detail?: string; status: string; events: string[]; }
export function clearScreen(): void { if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H"); }
export function renderMainScreen(state: TuiState): void {
  const project = path.basename(state.workspace) || state.workspace;
  const title = `The Loop terminal agent  ${project}  ${state.model === "not configured" ? "○" : "●"}`;
  const marker = state.status === "Ready" ? "○" : state.status === "Done" ? "✓" : state.status === "Error" ? "✕" : "●";
  const lines = [`╔${"═".repeat(BOX_WIDTH)}╗`, row(title), divider(), row(), row(state.prompt ? `> ${state.prompt}` : "What do you want to build?"), row(), row("─".repeat(BOX_WIDTH - 2)), row(`${marker} ${state.status}`), ...(state.detail ? [row(state.detail)] : []), ...state.events.slice(-4).map((event) => row(event)), row(), row("─".repeat(BOX_WIDTH - 2)), row(state.assistant ? `claude: ${state.assistant}` : ">"), row(), divider(), row("Enter send   Tab details   Esc stop   Ctrl+Z undo"), `╚${"═".repeat(BOX_WIDTH)}╝`];
  console.log(lines.join("\n"));
}
export function printAssistant(text: string): void { console.log(`\n${paint(ansi.bold + ansi.green, "claude>")} ${text}\n`); }
export function printError(error: string): void { console.error(`${paint(ansi.bold + ansi.red, "error>")} ${error}\n`); }
export function printApproval(command: string): void { console.log(`\n${paint(ansi.bold + ansi.yellow, "approval>")} ${command}`); }
export function printTools(tools: ReadonlyArray<{ name: string; kind: string; description: string }>): void { console.log(`\n${paint(ansi.bold + ansi.cyan, "tools>")}`); for (const tool of tools) console.log(`  ${paint(ansi.bold, tool.name)} ${paint(ansi.dim, `(${tool.kind}) ${tool.description}`)}`); console.log(); }
export function printHelp(): void { console.log(`\n${paint(ansi.bold + ansi.cyan, "commands>")}`); console.log("  /model    choose a live Anthropic model"); console.log("  /config   save the Anthropic API key securely"); console.log("  /tools    show available tools"); console.log("  /clear    clear conversation context"); console.log("  /compact  keep recent context"); console.log("  /exit     quit The Loop\n"); }
