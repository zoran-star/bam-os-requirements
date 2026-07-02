import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["api/_runtime/**/*.test.ts", "api/runtime/**/*.test.ts"],
    pool: "forks",
    fileParallelism: false,
  },
});
