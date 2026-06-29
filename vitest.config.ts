import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: {
      SESSION_SECRET: "test-session-secret-do-not-use-in-production",
    },
  },
});
