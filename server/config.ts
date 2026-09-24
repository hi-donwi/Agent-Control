import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface AppConfig {
  providers: {
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    google?: ProviderConfig;
  };
  defaultProvider: 'openai' | 'anthropic' | 'google';
  defaultModel: string;
  workspaceRoot?: string;
}

const CONFIG_DIR = join(homedir(), '.agent-control');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  providers: {},
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
};

/** Read config from ~/.agent-control/config.json. Creates default if missing. */
export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
    };
  } catch {
    console.error(`Failed to parse ${CONFIG_PATH}, using defaults.`);
    return { ...DEFAULT_CONFIG };
  }
}

/** Update config on disk. */
export function saveConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/** List available provider names (those with an API key configured). */
export function availableProviders(config: AppConfig): string[] {
  return Object.entries(config.providers)
    .filter(([, v]) => v?.apiKey)
    .map(([k]) => k);
}
