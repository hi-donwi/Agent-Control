import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { STATE_FILE, type ServerState } from './state.js';

/**
 * `appUrl` is the UI as the server tells an operator to open it - its origin plus the
 * bearer token in the query, which is how the token reaches the page (the host's CSP
 * blocks the inline `window.__AC_TOKEN__` script). The port is picked per run, so specs
 * take it from here rather than from a `baseURL` constant.
 */
const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as ServerState;

export const test = base.extend<{ appUrl: string }>({
  appUrl: [`${state.origin}/?token=${state.token}`, { option: true }],
});

export { expect };
