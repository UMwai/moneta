import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup-and-login",
      testMatch: /setup-and-login\.spec\.ts/,
    },
    {
      name: "import-and-ledger",
      dependencies: ["setup-and-login"],
      testMatch: /import-and-ledger\.spec\.ts/,
    },
    {
      name: "budgets-and-insights",
      dependencies: ["import-and-ledger"],
      testMatch: /budgets-and-insights\.spec\.ts/,
    },
  ],
});
