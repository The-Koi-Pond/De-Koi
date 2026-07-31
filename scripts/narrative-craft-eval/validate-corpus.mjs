import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONDITIONS = new Set(["baseline", "treatment"]);

export function parseJsonLines(text, source = "input") {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${source}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });
}

function requireNonEmptyString(row, field, index) {
  if (typeof row[field] !== "string" || !row[field].trim()) {
    throw new Error(`Row ${index + 1} requires a non-empty ${field}.`);
  }
}

function requireNonNegativeNumber(row, field, index) {
  if (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0) {
    throw new Error(`Row ${index + 1} requires a non-negative numeric ${field}.`);
  }
}

export function validateCorpusRows(rows, cases) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Corpus must contain at least one row.");
  const knownCases = new Set(cases.map((entry) => entry.caseId));
  const seen = new Set();
  const pairs = new Map();

  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Row ${index + 1} must be an object.`);
    for (const field of ["caseId", "condition", "model", "seed", "text"]) requireNonEmptyString(row, field, index);
    for (const field of ["latencyMs", "inputTokens", "outputTokens"]) requireNonNegativeNumber(row, field, index);
    if (!knownCases.has(row.caseId)) throw new Error(`Row ${index + 1} has unknown case ID "${row.caseId}".`);
    if (!CONDITIONS.has(row.condition)) {
      throw new Error(`Row ${index + 1} condition must be baseline or treatment.`);
    }

    const identity = [row.caseId, row.condition, row.model, row.seed].join("\u001f");
    if (seen.has(identity)) {
      throw new Error(
        `Duplicate corpus row for caseId=${row.caseId}, condition=${row.condition}, model=${row.model}, seed=${row.seed}.`,
      );
    }
    seen.add(identity);

    const pairIdentity = [row.caseId, row.model, row.seed].join("\u001f");
    const conditions = pairs.get(pairIdentity) ?? new Set();
    conditions.add(row.condition);
    pairs.set(pairIdentity, conditions);
  });

  for (const [identity, conditions] of pairs) {
    for (const condition of CONDITIONS) {
      if (!conditions.has(condition)) {
        const [caseId, model, seed] = identity.split("\u001f");
        throw new Error(`Pair caseId=${caseId}, model=${model}, seed=${seed} is missing ${condition}.`);
      }
    }
  }
  return rows;
}

export async function loadCases() {
  return JSON.parse(await readFile(resolve(SCRIPT_DIR, "cases.json"), "utf8"));
}

export async function validateCorpusFile(inputPath) {
  const cases = await loadCases();
  const rows = parseJsonLines(await readFile(inputPath, "utf8"), inputPath);
  return validateCorpusRows(rows, cases);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const input = argument("--input");
  const output = argument("--output");
  if (!input) throw new Error("Usage: validate-corpus.mjs --input <corpus.jsonl> [--output <normalized.jsonl>]");
  const rows = await validateCorpusFile(resolve(input));
  if (output) {
    await writeFile(resolve(output), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  }
  process.stdout.write(`Validated ${rows.length} corpus rows (${rows.length / 2} matched pairs).\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
