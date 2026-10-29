import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    // These UI files exercise large native pages. Do not overcommit workers
    // in the shared verification container; financial concurrency has explicit
    // PostgreSQL/browser tests rather than unrelated file-level overlap.
    fileParallelism: false,
  },
});
