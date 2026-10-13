import { defineConfig } from '@playwright/test';

/**
 * The UI harness (local only; CI runs `pnpm test`, not this). It drives the real server
 * against a disposable workspace - see `test/ui/global-setup.ts` - so a spec sees what an
 * operator sees, with no network call and no real provider.
 *
 * One worker: every spec shares one server and one workspace, and the workspace is rebuilt
 * per invocation, so the seeded approvals and coding session are pristine at the start.
 */
export default defineConfig({
  testDir: './test/ui',
  testMatch: '**/*.spec.ts',
  globalSetup: './test/ui/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
  },
});
