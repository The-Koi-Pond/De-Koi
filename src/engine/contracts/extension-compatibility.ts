import { APP_VERSION } from "./constants/defaults";

export type ExtensionCompatibilityStatus = "compatible" | "incompatible" | "not-declared";

type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const COMPARATOR_PATTERN = /^(>=|<=|>|<|=|\^|~)?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const WILDCARD_PATTERN = /^(?:\*|x|X|(\d+)\.(?:\*|x|X)|(\d+)\.(\d+)\.(?:\*|x|X))$/;

function parseVersion(value: string): SemanticVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber < bNumber ? -1 : 1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function upperBoundFor(operator: "^" | "~", version: SemanticVersion): SemanticVersion {
  if (operator === "~") return { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] };
  if (version.major > 0) return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
  if (version.minor > 0) return { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] };
  return { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] };
}

function satisfiesComparator(version: SemanticVersion, token: string): boolean {
  const wildcard = WILDCARD_PATTERN.exec(token);
  if (wildcard) {
    if (wildcard[2] !== undefined && version.major !== Number(wildcard[2])) return false;
    if (wildcard[3] !== undefined && version.minor !== Number(wildcard[3])) return false;
    if (wildcard[1] !== undefined && version.major !== Number(wildcard[1])) return false;
    return true;
  }
  const match = COMPARATOR_PATTERN.exec(token);
  if (!match) return false;
  const operator = match[1] ?? "=";
  const target = parseVersion(match[2]);
  if (!target) return false;
  const comparison = compareVersions(version, target);
  if (operator === "^") return comparison >= 0 && compareVersions(version, upperBoundFor("^", target)) < 0;
  if (operator === "~") return comparison >= 0 && compareVersions(version, upperBoundFor("~", target)) < 0;
  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  return comparison === 0;
}

export function isValidExtensionCompatibilityRange(value: string): boolean {
  const alternatives = value
    .trim()
    .split("||")
    .map((part) => part.trim());
  return (
    alternatives.length > 0 &&
    alternatives.every(
      (part) =>
        part.length > 0 &&
        part.split(/\s+/).every((token) => COMPARATOR_PATTERN.test(token) || WILDCARD_PATTERN.test(token)),
    )
  );
}

export function assertValidExtensionCompatibility(value: string): string {
  const trimmed = value.trim();
  if (!isValidExtensionCompatibilityRange(trimmed)) {
    throw new Error("Extension package compatibility.deKoi must be a valid semantic version range.");
  }
  return trimmed;
}

export function extensionCompatibilityStatus(
  range: string | null | undefined,
  appVersion = APP_VERSION,
): ExtensionCompatibilityStatus {
  if (!range?.trim()) return "not-declared";
  const normalized = assertValidExtensionCompatibility(range);
  const version = parseVersion(appVersion);
  if (!version) throw new Error("De-Koi application version must be semantic version data.");
  const compatible = normalized
    .split("||")
    .some((part) => part.trim().split(/\s+/).every((token) => satisfiesComparator(version, token)));
  return compatible ? "compatible" : "incompatible";
}
