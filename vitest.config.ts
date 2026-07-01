import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{spec,test}.{ts,tsx}", "tests/unit/**/*.{spec,test}.{ts,tsx}", "services/**/*.{spec,test}.ts"],
    environment: "jsdom",
  },
});
