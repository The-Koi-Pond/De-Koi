import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function numeric(value, field) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Feature input has invalid ${field}.`);
  return parsed;
}

function booleanish(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["true", "yes", "1", "present"].includes(normalized)) return true;
  if (["false", "no", "0", "n/a", "na", "none", "absent", ""].includes(normalized)) return false;
  throw new Error(`Feature input has invalid present value "${value}".`);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function identity(row) {
  return [row.caseId, row.model, row.seed].join("\u001f");
}

export function summarizeFeatureRows(rows) {
  const generations = new Map();
  for (const row of rows) {
    for (const field of ["caseId", "condition", "model", "seed", "featureId"]) {
      if (typeof row[field] !== "string" || !row[field].trim()) {
        throw new Error(`Feature input requires ${field}.`);
      }
    }
    if (row.condition !== "baseline" && row.condition !== "treatment") {
      throw new Error("Feature input condition must be baseline or treatment.");
    }
    const key = `${identity(row)}\u001f${row.condition}`;
    const generation = generations.get(key) ?? {
      caseId: row.caseId,
      condition: row.condition,
      model: row.model,
      seed: row.seed,
      latencyMs: numeric(row.latencyMs, "latencyMs"),
      inputTokens: numeric(row.inputTokens, "inputTokens"),
      outputTokens: numeric(row.outputTokens, "outputTokens"),
      features: new Map(),
    };
    if (generation.features.has(row.featureId)) {
      throw new Error(`Duplicate feature "${row.featureId}" for ${key}.`);
    }
    generation.features.set(row.featureId, booleanish(row.present));
    generations.set(key, generation);
  }

  const pairIds = new Set([...generations.values()].map(identity));
  const pairs = [];
  const missingPairs = [];
  for (const pairId of [...pairIds].sort()) {
    const [caseId, model, seed] = pairId.split("\u001f");
    const baseline = generations.get(`${pairId}\u001fbaseline`);
    const treatment = generations.get(`${pairId}\u001ftreatment`);
    if (!baseline || !treatment) {
      missingPairs.push({
        caseId,
        model,
        seed,
        missingCondition: baseline ? "treatment" : "baseline",
      });
      continue;
    }
    pairs.push({ baseline, treatment });
  }

  const featureIds = new Set(
    pairs.flatMap(({ baseline, treatment }) => [...baseline.features.keys(), ...treatment.features.keys()]),
  );
  const features = [...featureIds].sort().map((featureId) => {
    const comparable = pairs.filter(
      ({ baseline, treatment }) => baseline.features.has(featureId) && treatment.features.has(featureId),
    );
    const baselinePresent = comparable.filter(({ baseline }) => baseline.features.get(featureId)).length;
    const treatmentPresent = comparable.filter(({ treatment }) => treatment.features.get(featureId)).length;
    const matchedPairs = comparable.length;
    const baselineRate = matchedPairs ? baselinePresent / matchedPairs : 0;
    const treatmentRate = matchedPairs ? treatmentPresent / matchedPairs : 0;
    return {
      featureId,
      matchedPairs,
      baselinePresent,
      treatmentPresent,
      baselineRate,
      treatmentRate,
      delta: treatmentRate - baselineRate,
    };
  });

  const baselineRows = pairs.map((pair) => pair.baseline);
  const treatmentRows = pairs.map((pair) => pair.treatment);
  const baselineLatencyMedian = median(baselineRows.map((row) => row.latencyMs));
  const treatmentLatencyMedian = median(treatmentRows.map((row) => row.latencyMs));
  const total = (values) => values.reduce((sum, value) => sum + value, 0);
  return {
    matchedPairs: pairs.length,
    missingPairs,
    features,
    performance: {
      latencyMs: {
        baselineMedian: baselineLatencyMedian,
        treatmentMedian: treatmentLatencyMedian,
        delta:
          baselineLatencyMedian === null || treatmentLatencyMedian === null
            ? null
            : treatmentLatencyMedian - baselineLatencyMedian,
      },
      inputTokens: {
        baselineTotal: total(baselineRows.map((row) => row.inputTokens)),
        treatmentTotal: total(treatmentRows.map((row) => row.inputTokens)),
        delta: total(treatmentRows.map((row) => row.inputTokens)) - total(baselineRows.map((row) => row.inputTokens)),
      },
      outputTokens: {
        baselineTotal: total(baselineRows.map((row) => row.outputTokens)),
        treatmentTotal: total(treatmentRows.map((row) => row.outputTokens)),
        delta: total(treatmentRows.map((row) => row.outputTokens)) - total(baselineRows.map((row) => row.outputTokens)),
      },
    },
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const input = argument("--input");
  const output = argument("--output");
  if (!input) throw new Error("Usage: summarize-features.mjs --input <features.csv> [--output <summary.json>]");
  const rows = parseCsv(await readFile(resolve(input), "utf8"));
  const summary = summarizeFeatureRows(rows);
  const rendered = `${JSON.stringify(summary, null, 2)}\n`;
  if (output) await writeFile(resolve(output), rendered, "utf8");
  else process.stdout.write(rendered);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
