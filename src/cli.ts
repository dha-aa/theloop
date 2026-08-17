import { access, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "1.0.0";

export async function handleCliArguments(args: string[]): Promise<{ handled: boolean; workspace?: string }> {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`TheLoop ${VERSION}`);
    return { handled: true };
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log("TheLoop — local-first terminal coding agent");
    console.log("\nUsage: theloop [directory]\n");
    console.log("Commands: theloop doctor | update | uninstall [--purge]");
    console.log("TUI commands: /model /config [provider] /provider /providers /team /agents /tasks");
    return { handled: true };
  }
  if (args[0] === "doctor") {
    const root = process.env.THELOOP_GLOBAL_ROOT || path.join(process.env.HOME || process.cwd(), ".theloop");
    const runtime = path.join(root, "runtime");
    const cli = path.join(root, "bin", "theloop");
    console.log("TheLoop Doctor\n");
    console.log(`${await exists(cli) ? "✓" : "✕"} CLI executable ${await exists(cli) ? "found" : "missing"}`);
    console.log(`${await exists(runtime) ? "✓" : "✕"} Runtime ${await exists(runtime) ? "found" : "missing"}`);
    console.log(`${await exists(path.join(root, "config")) ? "✓" : "○"} Global configuration`);
    console.log(`${await exists(path.join(root, "credentials")) ? "✓" : "○"} Global credentials`);
    return { handled: true };
  }
  if (args[0] === "uninstall" || args[0] === "update") {
    const scriptName = args[0] === "uninstall" ? "uninstall.sh" : "install.sh";
    const root = process.env.THELOOP_GLOBAL_ROOT || path.join(process.env.HOME || process.cwd(), ".theloop");
    const script = path.join(root, scriptName);
    if (!await exists(script)) throw new Error(`${scriptName} is not available in the global installation.`);
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("bash", [script, ...args.slice(1)], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
    return { handled: true };
  }
  const candidate = args.find((arg) => !arg.startsWith("-"));
  if (candidate) {
    const workspace = path.resolve(candidate);
    const info = await stat(workspace).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`Project directory does not exist: ${workspace}`);
    return { handled: false, workspace };
  }
  return { handled: false };
}

async function exists(target: string): Promise<boolean> { try { await access(target); return true; } catch { return false; } }
