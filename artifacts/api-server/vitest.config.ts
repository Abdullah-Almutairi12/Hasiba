import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
    // tsyringe (loaded transitively by @peculiar/x509) requires the
    // reflect-metadata polyfill to be loaded before any of its
    // consumers. The bundled production entry imports it on line 1;
    // tests need the same guarantee here.
    setupFiles: ["reflect-metadata"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
