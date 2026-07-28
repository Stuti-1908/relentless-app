import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_e2e",
  fullyParallel: false, // Run tests sequentially to avoid in-memory database conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Keep workers at 1 to prevent shared mock database state collision
  reporter: "line",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:3001/api/mock/supabase",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mock-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
      AIRTABLE_API_URL: "http://localhost:3001/api/mock/airtable",
      GHL_API_URL: "http://localhost:3001/api/mock/ghl",
      GOOGLE_TOKEN_URL: "http://localhost:3001/api/mock/google/token",
      GOOGLE_CALENDAR_URL: "http://localhost:3001/api/mock/google/calendar",
      N8N_WARROOM_URL: "http://localhost:3001/api/mock/warroom",
    },
  },
});
