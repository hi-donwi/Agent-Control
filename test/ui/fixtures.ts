import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * `deskUrl` and `appUrl` are token-free browser addresses; the app exchanges its loopback
 * origin for a token through GET /auth. `origin` and the token are available to direct API
 * assertions. The port is picked per run, so specs take it from here rather than from a
 * `baseURL` constant. `home` is the isolated HOME the server ran with.
 */
const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState;

export const test = base.extend<{ deskUrl: string; appUrl: string; origin: string; home: string; token: string }>({
  deskUrl: [`${state.origin}/`, { option: true }],
  appUrl: [`${state.origin}/?ui=classic`, { option: true }],
  origin: [state.origin, { option: true }],
  home: [state.home, { option: true }],
  token: [state.token, { option: true }],
});

export { expect };
