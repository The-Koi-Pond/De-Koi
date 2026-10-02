// Enforces DESIGN.md's Nine-Pixel Floor Rule: no text smaller than 0.5625rem (9px).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIN_TEXT_REM = 0.5625;
const PX_PER_REM = 16;

function toRem(value, unit) {
  const number = Number.parseFloat(value);
  return unit === "px" ? number / PX_PER_REM : number;
}

/** Text sizes below the floor in one file's source, as { line, size } entries. */
export function findTooSmallText(source) {
  const findings = [];
  const patterns = [
    // Tailwind arbitrary sizes, with any variant prefix: text-[0.5rem], md:text-[8px].
    /text-\[(\d*\.?\d+)(rem|px)\]/g,
    // Plain CSS declarations.
    /font-size:\s*(\d*\.?\d+)(rem|px)\b/g,
  ];
  source.split("\n").forEach((text, index) => {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        if (toRem(match[1], match[2]) < MIN_TEXT_REM) findings.push({ line: index + 1, size: match[0] });
      }
    }
  });
  return findings;
}

function trackedSourceFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--", "src/*.ts", "src/*.tsx", "src/*.css"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\0").filter((file) => file && !/\.(spec|test)\.tsx?$/.test(file));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = [];
  const files = trackedSourceFiles();
  for (const file of files) {
    for (const finding of findTooSmallText(readFileSync(file, "utf8"))) {
      failures.push(`${file}:${finding.line} uses ${finding.size}`);
    }
  }
  if (failures.length > 0) {
    console.error(
      `Text below the ${MIN_TEXT_REM}rem (9px) floor (DESIGN.md, The Nine-Pixel Floor Rule):\n` +
        failures.map((failure) => `  ${failure}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`Minimum text size check passed (${files.length} files).`);
}
