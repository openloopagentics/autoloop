import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Main suite only — the rules suite has its own config (vitest.rules.config.ts).
    include: ["test/**/*.test.ts"],
    // tests talk to the Firestore emulator; run serially to avoid cross-test data races
    fileParallelism: false,
    testTimeout: 20000,
  },
});
