import { readFile } from "node:fs/promises";
import ts from "typescript";

const rustContractsPath = "src-tauri/src/commands/storage/contracts.rs";
const tsManifestPath = "src/engine/capabilities/storage-collections.ts";

function unique(values, label) {
  const seen = new Set();
  const duplicates = [];
  for (const value of values) {
    if (seen.has(value)) duplicates.push(value);
    seen.add(value);
  }
  if (duplicates.length > 0) {
    throw new Error(`Duplicate ${label}: ${duplicates.join(", ")}`);
  }
  return values;
}

function formatList(values) {
  return values.length ? values.join(", ") : "(none)";
}

function parseRustCollectionNames(source) {
  const block = source.match(/pub\(crate\) const COLLECTIONS:[\s\S]*?\];/)?.[0];
  if (!block) {
    throw new Error(`Could not find COLLECTIONS in ${rustContractsPath}.`);
  }
  return unique(
    [...block.matchAll(/contract\(\s*"([^"]+)"/g)].map((match) => match[1]),
    "Rust collections",
  );
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    current.kind === ts.SyntaxKind.SatisfiesExpression
  ) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function booleanProperty(object, name) {
  const property = object.properties.find(
    (item) => ts.isPropertyAssignment(item) && propertyNameText(item.name) === name,
  );
  if (!property || !ts.isPropertyAssignment(property)) return null;
  const value = unwrapExpression(property.initializer);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function stringProperty(object, name) {
  const property = object.properties.find(
    (item) => ts.isPropertyAssignment(item) && propertyNameText(item.name) === name,
  );
  if (!property || !ts.isPropertyAssignment(property)) return null;
  const value = unwrapExpression(property.initializer);
  return ts.isStringLiteral(value) ? value.text : null;
}

function parseTsManifest(source) {
  const file = ts.createSourceFile(tsManifestPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer = null;

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "STORAGE_COLLECTIONS") {
      initializer = node.initializer ? unwrapExpression(node.initializer) : null;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error(`Could not find STORAGE_COLLECTIONS object in ${tsManifestPath}.`);
  }

  const collections = [];
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    const value = unwrapExpression(property.initializer);
    if (!name || !ts.isObjectLiteralExpression(value)) {
      throw new Error(`Storage collection manifest entries must be plain object properties.`);
    }
    const genericApi = booleanProperty(value, "genericApi");
    const internalOnly = booleanProperty(value, "internalOnly") === true;
    const internalReason = stringProperty(value, "internalReason");
    if (genericApi === null) {
      throw new Error(`${name} is missing a boolean genericApi marker.`);
    }
    if (!genericApi && !internalOnly) {
      throw new Error(`${name} disables genericApi but is not explicitly marked internalOnly.`);
    }
    if (internalOnly && genericApi) {
      throw new Error(`${name} cannot be both genericApi and internalOnly.`);
    }
    if (internalOnly && !internalReason) {
      throw new Error(`${name} is internalOnly but does not explain internalReason.`);
    }
    collections.push({ name, genericApi, internalOnly });
  }

  unique(
    collections.map((collection) => collection.name),
    "TypeScript manifest collections",
  );
  return collections;
}

const [rustSource, tsSource] = await Promise.all([
  readFile(rustContractsPath, "utf8"),
  readFile(tsManifestPath, "utf8"),
]);

const rustNames = parseRustCollectionNames(rustSource);
const tsCollections = parseTsManifest(tsSource);
const tsNames = tsCollections.map((collection) => collection.name);
const rustSet = new Set(rustNames);
const tsSet = new Set(tsNames);
const missingFromTs = rustNames.filter((name) => !tsSet.has(name));
const extraInTs = tsNames.filter((name) => !rustSet.has(name));

if (missingFromTs.length > 0 || extraInTs.length > 0) {
  throw new Error(
    [
      "Storage collection contract drift detected.",
      `Missing from ${tsManifestPath}: ${formatList(missingFromTs)}`,
      `Not present in ${rustContractsPath}: ${formatList(extraInTs)}`,
    ].join("\n"),
  );
}

const internalNames = tsCollections
  .filter((collection) => collection.internalOnly)
  .map((collection) => collection.name);
console.log(
  `Storage collection contracts are aligned: ${rustNames.length} Rust collections, ${
    tsCollections.length - internalNames.length
  } generic frontend entities, ${internalNames.length} internal-only.`,
);
