import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false }
    }
  }
});

