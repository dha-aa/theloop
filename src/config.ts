import "dotenv/config";
import { appendFile, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_FILE = ".env";

export function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export async function saveApiKey(apiKey: string, cwd = process.cwd()): Promise<void> {
  const value = apiKey.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("The API key format does not look like an Anthropic key.");
  }
  const envPath = path.join(cwd, ENV_FILE);
  let current = "";
  try {
    current = await readFile(envPath, "utf8");
  } catch {
    current = "";
  }
  const line = `ANTHROPIC_API_KEY=${value}`;
  const pattern = /^ANTHROPIC_API_KEY=.*$/m;
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  await writeFile(envPath, next, { mode: 0o600 });
  await chmod(envPath, 0o600);
  process.env.ANTHROPIC_API_KEY = value;
}

export type ConfiguredProvider = "anthropic" | "openai" | "gemini" | "openrouter";
const PROVIDER_ENV_KEYS: Record<ConfiguredProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function getProviderApiKey(provider: ConfiguredProvider): string | undefined {
  return process.env[PROVIDER_ENV_KEYS[provider]]?.trim() || undefined;
}

export async function saveProviderApiKey(provider: ConfiguredProvider, apiKey: string, cwd = process.cwd()): Promise<void> {
  const value = apiKey.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error("The provider API key must be a non-empty single-line value.");
  const envName = PROVIDER_ENV_KEYS[provider];
  const envPath = path.join(cwd, ENV_FILE);
  let current = "";
  try { current = await readFile(envPath, "utf8"); } catch { current = ""; }
  const line = `${envName}=${value}`;
  const pattern = new RegExp(`^${envName}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  await writeFile(envPath, next, { mode: 0o600 });
  await chmod(envPath, 0o600);
  process.env[envName] = value;
}
