import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suite for the QA audit. Requires a real browser locally:
 *   npx playwright install chromium firefox webkit
 */
export default defineConfig({
  testDir: "./qa",
  testMatch: /e2e\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "qa/playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.QA_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
    { name: "edge", use: { ...devices["Desktop Edge"] } },
  ],
  webServer: process.env.QA_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -H 0.0.0.0 -p 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
