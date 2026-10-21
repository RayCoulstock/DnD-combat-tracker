import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', timeout: 120000, expect: { timeout: 15000 }, workers: 1,
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173', viewport: { width: 1400, height: 1000 },
    launchOptions: { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
  },
})
