import { readFile } from "node:fs/promises";
import path from "node:path";
import { runTerminal } from "./tools/terminal.js";

export interface DirectResult {
  label: string;
  command: string;
  output: string;
  exitCode: number;
}

interface PackageMetadata {
  scripts?: Record<string, string>;
  packageManager?: string;
}

function normalized(input: string): string {
  return input.trim().toLowerCase().replace(/[?.!]+$/g, "");
}

function packageManager(metadata: PackageMetadata): string {
  if (metadata.packageManager?.startsWith("pnpm")) return "pnpm";
  if (metadata.packageManager?.startsWith("yarn")) return "yarn";
  if (metadata.packageManager?.startsWith("bun")) return "bun";
  return "npm";
}

async function projectScript(workspace: string, script: string): Promise<string | null> {
  try {
    const metadata = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8")) as PackageMetadata;
    if (!metadata.scripts?.[script]) return null;
    const manager = packageManager(metadata);
    return manager === "npm" ? `npm run ${script}` : `${manager} ${script}`;
  } catch {
    return null;
  }
}

async function directTerminal(label: string, command: string, workspace: string): Promise<DirectResult> {
  const result = await runTerminal(command, workspace, async () => true);
  return { label, command: result.command, output: result.output, exitCode: result.exitCode };
}

export async function routeLocalCommand(input: string, workspace: string): Promise<DirectResult | null> {
  const command = normalized(input);
  if (["list files", "show files", "show the files", "list the files"].includes(command)) {
    return directTerminal("listed files", "ls -la", workspace);
  }
  if (["pwd", "show current directory", "show the current directory", "show working directory"].includes(command)) {
    return directTerminal("current directory", "pwd", workspace);
  }
  if (["show git status", "git status", "show status"].includes(command)) {
    return directTerminal("git status", "git status --short", workspace);
  }
  if (["show branches", "list branches", "git branches"].includes(command)) {
    return directTerminal("branches", "git branch --all --no-color", workspace);
  }
  if (["show recent commits", "recent commits", "git log"].includes(command)) {
    return directTerminal("recent commits", "git log -5 --oneline", workspace);
  }
  if (["show changes", "show change summary", "git diff stat"].includes(command)) {
    return directTerminal("change summary", "git diff --stat", workspace);
  }
  if (["show diff", "git diff"].includes(command)) {
    return directTerminal("diff", "git diff", workspace);
  }
  if (["show package.json", "open package.json", "read package.json"].includes(command)) {
    return directTerminal("package.json", "cat package.json", workspace);
  }
  if (["run tests", "run test", "test"].includes(command)) {
    const testCommand = await projectScript(workspace, "test");
    return testCommand ? directTerminal("tests", testCommand, workspace) : directTerminal("tests", "printf 'No test script found in package.json'", workspace);
  }
  if (["run build", "build"].includes(command)) {
    const buildCommand = await projectScript(workspace, "build");
    return buildCommand ? directTerminal("build", buildCommand, workspace) : directTerminal("build", "printf 'No build script found in package.json'", workspace);
  }
  return null;
}
