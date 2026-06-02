import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test-rules/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
