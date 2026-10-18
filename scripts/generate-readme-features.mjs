// Writes the README's feature list from the in-app Discover registry, so the GitHub page lists what the app
// actually has. Every feature PR already updates the registry; this keeps the README in step with it.
//   node scripts/generate-readme-features.mjs          rewrite the block in README.md
//   node scripts/generate-readme-features.mjs --check  fail if README.md is out of date
import { readFile, writeFile } from "node:fs/promises";

const registryPath = "src/features/shell/discovery/discovery-entries.json";
const readmePath = "README.md";
const START =
  "<!-- features:start (generated from the Discover registry by `pnpm docs:readme-features`; do not edit) -->";
const END = "<!-- features:end -->";
const CATEGORY_ORDER = ["Chat modes", "Getting started", "Library", "Agents", "Media", "Settings", "Advanced", "Help"];
const COVERAGE_NOTE = { experimental: " _(experimental)_", "needs-polish": " _(rough edges)_" };

function renderFeatureBlock(entries) {
  const known = new Set(CATEGORY_ORDER);
  const unknown = [...new Set(entries.map((entry) => entry.category))].filter((category) => !known.has(category));
  if (unknown.length > 0) throw new Error(`Unknown Discover categories: ${unknown.join(", ")}`);
  const sections = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = entries.filter((entry) => entry.category === category);
    if (inCategory.length === 0) continue;
    const lines = inCategory.map(
      (entry) => `- **${entry.title.trim()}**${COVERAGE_NOTE[entry.coverage] ?? ""}: ${entry.summary.trim()}`,
    );
    sections.push(
      `<details>\n<summary><b>${category}</b> (${inCategory.length})</summary>\n\n${lines.join("\n")}\n\n</details>`,
    );
  }
  return `${START}\n\n${sections.join("\n\n")}\n\n${END}`;
}

function replaceFeatureBlock(readme, block) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${readmePath} is missing the generated feature markers`);
  return readme.slice(0, start) + block + readme.slice(end + END.length);
}

async function main() {
  const entries = JSON.parse(await readFile(registryPath, "utf8"));
  const readme = (await readFile(readmePath, "utf8")).replace(/\r\n/g, "\n");
  const next = replaceFeatureBlock(readme, renderFeatureBlock(entries));
  if (process.argv.includes("--check")) {
    if (next !== readme) {
      console.error(
        `${readmePath} feature list is out of date with ${registryPath}. Run \`pnpm docs:readme-features\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`${readmePath} feature list matches the Discover registry (${entries.length} features).`);
    return;
  }
  if (next !== readme) await writeFile(readmePath, next);
  console.log(
    `${readmePath} feature list ${next === readme ? "already current" : "updated"} (${entries.length} features).`,
  );
}

await main();
