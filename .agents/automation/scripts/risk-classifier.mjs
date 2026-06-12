const RISK_CATEGORIES = [
  {
    name: "installer-upgrade",
    keywords: ["installer", "install", "upgrade", "uninstall", "nsis"],
    pathRules: [/^win\/installer\//i],
  },
  {
    name: "storage-db-schema-migration",
    keywords: ["storage", "database", "db", "schema", "migration", "migrate"],
    pathRules: [/(^|\/)(migrations?|schema|drizzle)(\/|\.|$)/i, /(^|\/)(storage|repositories|database|db)(\/|\.|$)/i],
  },
  {
    name: "import-export",
    keywords: ["import", "export"],
    pathRules: [/(^|\/)(import|export)(\/|\.|$)/i],
  },
  {
    name: "prompt-agent-lorebook",
    keywords: ["prompt", "agent", "lorebook", "prompt injection", "preset", "override"],
    pathRules: [/(^|\/)(prompt|prompting|generation|agents?|lorebook)(\/|\.|$)/i],
  },
  {
    name: "destructive-user-data",
    keywords: ["destructive", "delete", "backup", "user-data", "data-loss", "data loss"],
    pathRules: [],
  },
  {
    name: "compatibility-legacy",
    keywords: ["compatibility", "legacy", "cross-entrypoint", "entrypoint", "backward compatible"],
    pathRules: [],
  },
  {
    name: "cross-entrypoint-behavior",
    keywords: [
      "cross-entrypoint",
      "cross entrypoint",
      "all entrypoints",
      "all surface modes",
      "all 3 surface modes",
      "all three surface modes",
      "surface modes",
    ],
    pathRules: [],
  },
  {
    name: "release-version-dependency",
    keywords: ["release", "version", "dependency", "dependencies"],
    pathRules: [
      /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|CHANGELOG\.md)$/i,
      /(^|\/)(android\/app\/build\.gradle|packages\/shared\/src\/constants\/defaults\.ts)$/i,
    ],
  },
  {
    name: "auth-credentials-external-service",
    keywords: ["auth", "oauth", "credential", "secret", "external service", "api key"],
    pathRules: [/(^|\/)(auth|oauth|credentials?|secrets?)(\/|\.|$)/i],
  },
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function normalizePath(path) {
  return String(path ?? "").replaceAll("\\", "/");
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function includesKeyword(value, keywords) {
  const haystack = text(value).toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function authoredPrBodyText(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const kept = [];
  let heading = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      heading = headingMatch[1].toLowerCase();
      continue;
    }

    if (
      !line ||
      line.startsWith("<!--") ||
      /^-\s+\[[ x]\]/i.test(line) ||
      /^#+\s+/.test(line) ||
      /^(not applicable|n\/a)\.?$/i.test(line)
    ) {
      continue;
    }

    if (["validation", "docs and release impact", "ui evidence (if applicable)"].includes(heading)) {
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n");
}

function addSignal(signalsByCategory, categoryName, signal) {
  if (!signalsByCategory.has(categoryName)) signalsByCategory.set(categoryName, []);
  signalsByCategory.get(categoryName).push(signal);
}

function classify({ paths = [], texts = [] }) {
  const signalsByCategory = new Map();
  const normalizedPaths = asArray(paths).map(normalizePath);
  const textValues = asArray(texts);

  for (const category of RISK_CATEGORIES) {
    for (const path of normalizedPaths) {
      if (category.pathRules.some((rule) => rule.test(path))) {
        addSignal(signalsByCategory, category.name, `risky path: ${path}`);
      }
    }

    for (const value of textValues) {
      if (includesKeyword(value, category.keywords)) {
        addSignal(signalsByCategory, category.name, `risk text: ${text(value)}`);
      }
    }
  }

  const categories = [...signalsByCategory.keys()];
  const signals = categories.flatMap((category) => [...new Set(signalsByCategory.get(category))]);
  return {
    required: categories.length > 0,
    categories,
    signals: [...new Set(signals)],
    matchedFiles: normalizedPaths.filter((path) =>
      RISK_CATEGORIES.some((category) => category.pathRules.some((rule) => rule.test(path))),
    ),
  };
}

export function classifyLedgerRisk(ledger) {
  return classify({
    paths: [
      ...asArray(ledger.scope?.touchedFiles),
      ...asArray(ledger.scope?.intendedFiles),
      ...asArray(ledger.changedFiles),
      ...asArray(ledger.productionChangedFiles),
    ],
    texts: [
      ledger.claimBoundary?.riskType,
      ledger.riskClaimMatrix?.riskType,
      ledger.task?.classification,
      ledger.task?.type,
      ledger.coreClaim,
      ledger.claimBoundary?.coreClaim,
      ...(Array.isArray(ledger.scope?.riskFlags) ? ledger.scope.riskFlags : []),
      ...(Array.isArray(ledger.notes) ? ledger.notes : []),
    ],
  });
}

export function classifyPrRisk(pr) {
  return classify({
    paths: (pr.files ?? []).map((file) => file.path),
    texts: [
      pr.title,
      authoredPrBodyText(pr.body),
      ...(pr.labels ?? []).map((label) => label.name),
      pr.headRefName,
    ],
  });
}

export function hasReviewerDispositions(proofHealth) {
  const rows = proofHealth?.reviewThreadLedger ?? [];
  return rows.length > 0 && rows.every((row) => row.finding && (row.disposition || row.classification));
}
