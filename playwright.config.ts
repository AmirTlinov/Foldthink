import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/journeys",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4180",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm build && pnpm --filter @foldthink/web preview --host 127.0.0.1 --port 4180 --strictPort",
    url: "http://127.0.0.1:4180",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
