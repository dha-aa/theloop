import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 4000;

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(-[^\s]+\s+)*-r[^\s]*f\b/i, "recursive force deletion is blocked"],
  [/(^|[;&|]\s*)sudo\b/i, "sudo is blocked"],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, "system power commands are blocked"],
  [/\b(mkfs|fdisk|diskutil|dd\s+if=)\b/i, "disk-management commands are blocked"],
  [/(curl|wget)[^\n|]*\|\s*(sh|bash|zsh)\b/i, "piped remote script execution is blocked"],
  [/(^|[\s/])(?:\.env|\.ssh|id_rsa|credentials\.json)(?:$|[\s/])/i, "credential paths are blocked"],
  [/(^|[\s/])(?:\/etc|\/var\/root|\/System|\/Library)(?:$|[\s/])/i, "system paths are blocked"],
  [/\b(git\s+push|git\s+reset\s+--hard|git\s+clean\s+-[^\n]*f)\b/i, "destructive git commands are blocked"],
  [/(^|[;&|]\s*)cd\s+(\.\.|~|\/)/i, "paths outside the project are blocked"],
  [/(^|[\s;&|])(?:\.\.?\/){2}/, "parent-directory traversal is blocked"],
  [/(^|[\s;&|])\/(?:[^\s;&|]*)/, "absolute paths outside the project are blocked"],
  [/(^|[\s;&|])~(?:\/|$)/, "home-directory paths are blocked"],
  [/\b(printenv|env)\b|\$[A-Z_][A-Z0-9_]*/i, "environment and credential inspection is blocked"],
  [/(^|[;&|]\s*)(node|python3?|ruby|perl)\s+(-e|--eval|-c)\b/i, "inline scripts are blocked"],
];

export interface TerminalResult { command: string; output: string; exitCode: number; }

export function validateTerminalCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "the command is empty";
  if (trimmed.includes("\0")) return "null bytes are not allowed";
  for (const [pattern, reason] of BLOCKED_PATTERNS) if (pattern.test(trimmed)) return reason;
  return null;
}

function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text || "(no output)";
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
}

export async function runTerminal(command: string, workspace: string, approve: (command: string) => Promise<boolean>): Promise<TerminalResult> {
  const trimmed = command.trim();
  const blockedReason = validateTerminalCommand(trimmed);
  if (blockedReason) return { command: trimmed, output: `Blocked: ${blockedReason}.`, exitCode: 126 };
  if (!(await approve(trimmed))) return { command: trimmed, output: "User denied the command.", exitCode: 1 };

  try {
    const result = await execAsync(trimmed, { cwd: path.resolve(workspace), maxBuffer: 1024 * 1024, timeout: 120_000, shell: "/bin/sh" });
    return { command: trimmed, output: capOutput([result.stdout, result.stderr].filter(Boolean).join("\n").trim()), exitCode: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return { command: trimmed, output: capOutput([failed.stdout, failed.stderr].filter(Boolean).join("\n").trim() || "Command failed without output."), exitCode: typeof failed.code === "number" ? failed.code : 1 };
  }
}
