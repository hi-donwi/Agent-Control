import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Agent-Control's own preferences in ~/.agent-control/config.json: the endpoint and model a
 * new chat starts with. Provider accounts and keys belong in Agent Brain, never here; the
 * file is read only, and the app never writes it.
 */
export interface AppConfig {
  defaultProvider: string;
  defaultModel: string;
}

export interface LoadedConfig {
  config: AppConfig;
  /** Providers whose API key is still in the file from before chat went through Brain; never used. */
  ignoredKeys: string[];
}

export const CONFIG_PATH = join(homedir(), '.agent-control', 'config.json');

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The preferences in a parsed config file. Returns provider names only, never a key. */
export function parseConfig(raw: unknown): LoadedConfig {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const providers = (parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {}) as Record<string, unknown>;
  const ignoredKeys = Object.entries(providers)
    .filter(([, value]) => Boolean(text((value as { apiKey?: unknown } | null)?.apiKey)))
    .map(([name]) => name);
  return {
    config: { defaultProvider: text(parsed.defaultProvider), defaultModel: text(parsed.defaultModel) },
    ignoredKeys,
  };
}

/** Read ~/.agent-control/config.json; defaults when it is absent or not JSON. */
export function loadConfig(path = CONFIG_PATH): LoadedConfig {
  if (!existsSync(path)) return parseConfig({});
  try {
    return parseConfig(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    console.error(`Failed to parse ${path}, using defaults.`);
    return parseConfig({});
  }
}
