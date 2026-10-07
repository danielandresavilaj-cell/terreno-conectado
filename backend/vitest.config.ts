import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
})
