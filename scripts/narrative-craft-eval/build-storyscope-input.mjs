import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadCases, validateCorpusFile, validateCorpusRows } from "./validate-corpus.mjs";

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildStoryScopeRows(rows, cases) {
  validateCorpusRows(rows, cases);
  const byId = new Map(cases.map((entry) => [entry.caseId, entry]));
  return [...rows]
    .sort((left, right) =>
      [left.caseId, left.model, left.seed, left.condition]
        .join("\u001f")
        .localeCompare([right.caseId, right.model, right.seed, right.condition].join("\u001f")),
    )
    .map((row, index) => ({
      prompt_id: index + 1,
      title: `${byId.get(row.caseId)?.title ?? row.caseId} [${row.condition} | ${row.model} | seed ${row.seed}]`,
      human_story: row.text,
      manifest: {
        prompt_id: index + 1,
        caseId: row.caseId,
        condition: row.condition,
        model: row.model,
        seed: row.seed,
        latencyMs: row.latencyMs,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      },
    }));
}

export function buildStoryScopeCsv(rows, cases) {
  const output = buildStoryScopeRows(rows, cases);
  return [
    "prompt_id,title,human_story",
    ...output.map((row) => [row.prompt_id, row.title, row.human_story].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const input = argument("--input");
  const output = argument("--output");
  if (!input || !output) {
    throw new Error("Usage: build-storyscope-input.mjs --input <corpus.jsonl> --output <storyscope.csv>");
  }
  const cases = await loadCases();
  const rows = await validateCorpusFile(resolve(input));
  const storyScopeRows = buildStoryScopeRows(rows, cases);
  await writeFile(resolve(output), buildStoryScopeCsv(rows, cases), "utf8");
  await writeFile(
    `${resolve(output)}.manifest.json`,
    `${JSON.stringify(
      storyScopeRows.map((row) => row.manifest),
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(`Wrote ${storyScopeRows.length} StoryScope rows and a sidecar manifest.\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
