import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "execution"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["execution/**/*.test.ts", "execution/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
