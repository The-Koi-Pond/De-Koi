import { defineConfig } from "vitest/config";

// Plain .ts tests run in Node; .tsx component tests run in jsdom. Building a jsdom
// window per file dominated suite time, so a .ts test that needs the DOM opts in
// with a `// @vitest-environment jsdom` docblock on its first line.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.{spec,test}.ts", "tests/unit/**/*.{spec,test}.ts", "services/**/*.{spec,test}.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.{spec,test}.tsx", "tests/unit/**/*.{spec,test}.tsx"],
        },
      },
    ],
  },
});
