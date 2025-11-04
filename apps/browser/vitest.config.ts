import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const pool = process.env.CI ? "basic" : "vmThreads";

export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(projectRoot, "src/lib"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/lib/server/**/*.{test,spec}.{js,ts}",
      "src/routes/**/*.{test,spec}.{js,ts}",
      "tests/**/*.{test,spec}.{js,ts}",
    ],
    pool,
    coverage: {
      reporter: ["text", "lcov"],
      enabled: false,
    },
  },
});
