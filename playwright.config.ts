import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.FOLDTHINK_EXTERNAL_BASE_URL;
const webApplication = {
  command: "pnpm build && pnpm --filter @foldthink/web preview --host 127.0.0.1 --port 4180 --strictPort",
  url: "http://127.0.0.1:4180",
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
};

const sharedServer = process.env.TEST_DATABASE_URL
  ? {
      command: "pnpm --filter @foldthink/server start",
      url: "http://127.0.0.1:8787/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        SESSION_HMAC_KEY: "playwright-session-key-with-at-least-32-bytes",
        PUBLIC_ORIGIN: "http://127.0.0.1:4180",
        COOKIE_SECURE: "false",
        PORT: "8787",
        REVISION: "playwright",
        ASSET_DIRECTORY: "/tmp/foldthink-playwright-assets",
      },
    }
  : undefined;

export default defineConfig({
  testDir: "./tests/journeys",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4180",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: externalBaseUrl
    ? undefined
    : sharedServer
      ? [sharedServer, webApplication]
      : webApplication,
});
