module.exports = {
  ci: {
    collect: {
      startServerCommand: "pnpm preview --host 127.0.0.1 --port 4173",
      startServerReadyPattern: "Local:",
      url: ["http://127.0.0.1:4173/"],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.7 }],
        "categories:accessibility": ["warn", { minScore: 0.8 }],
        "categories:best-practices": ["warn", { minScore: 0.8 }],
        "resource-summary:script:size": ["error", { maxNumericValue: 1800000 }],
        "resource-summary:stylesheet:size": ["error", { maxNumericValue: 260000 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
