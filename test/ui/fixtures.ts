import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * `appUrl` is the UI as the server tells an operator to open it - its origin plus the
 * bearer token in the query, which is how the token reaches the page when the host serves
 * it directly. `origin` is the same server without a token in the URL, for the path where
 * the token comes from the injected script instead. The port is picked per run, so specs
 * take it from here rather than from a `baseURL` constant. `home` is the isolated `HOME`
 * the server ran with, where its `~/.agent-control/config.json` lives.
 */
const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState;

export const test = base.extend<{ appUrl: string; origin: string; home: string }>({
  appUrl: [`${state.origin}/?token=${state.token}`, { option: true }],
  origin: [state.origin, { option: true }],
  home: [state.home, { option: true }],
});

export { expect };
