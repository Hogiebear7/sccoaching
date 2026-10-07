import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
    // Blocks real network access from every test file (loopback stays open). See __tests__/setup/network-guard.ts.
    setupFiles: ["./__tests__/setup/network-guard.ts"],
    env: {
      SESSION_SECRET: "test-session-secret-do-not-use-in-production",
    },
  },
});
