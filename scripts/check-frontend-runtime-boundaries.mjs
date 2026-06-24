import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FRONTEND_ROOTS = ["src/app", "src/features"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const RESOLUTION_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];
const TRANSPORT_ONLY_REMOTE_RUNTIME_IMPORTS = new Set([
  "invokeRemote",
  "streamRemoteJsonEvents",
  "streamRemoteLlm",
  "remoteFetchInit",
  "remoteHeaders",
  "remotePrivilegedHeaders",
]);

function normalizePath(path) {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

function displayPath(root, path) {
  return relative(root, path).replace(/\\/g, "/");
}

function listSourceFiles(root, directory) {
  const absoluteDirectory = resolve(root, directory);
  if (!existsSync(absoluteDirectory)) return [];

  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absolutePath = join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(root, relative(root, absolutePath)));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function candidatePaths(basePath) {
  const candidates = [];
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${basePath}${extension}`);
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
    candidates.push(join(basePath, `index${extension}`));
  }
  return candidates;
}

function resolveImport(root, importerPath, importSource) {
  let basePath = null;
  if (importSource.startsWith("./") || importSource.startsWith("../")) {
    basePath = resolve(dirname(importerPath), importSource);
  } else if (importSource.startsWith("@/")) {
    basePath = resolve(root, "src", importSource.slice(2));
  } else if (importSource.startsWith("src/")) {
    basePath = resolve(root, importSource);
  }
  if (!basePath) return null;

  for (const candidate of candidatePaths(basePath)) {
    if (existsSync(candidate)) return candidate;
  }
  return basePath;
}

function importNames(importDeclaration) {
  const namedBindings = importDeclaration.importClause?.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return [];
  return namedBindings.elements.map((element) => element.name.text);
}

function sourceFileKind(path) {
  return extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function findFrontendRuntimeBoundaryViolations(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const tauriClientPath = normalizePath(resolve(absoluteRoot, "src/shared/api/tauri-client.ts"));
  const remoteRuntimePath = normalizePath(resolve(absoluteRoot, "src/shared/api/remote-runtime.ts"));
  const files = FRONTEND_ROOTS.flatMap((directory) => listSourceFiles(absoluteRoot, directory)).sort();
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, sourceFileKind(file));

    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const importSource = statement.moduleSpecifier.text;
      const line = parsed.getLineAndCharacterOfPosition(statement.getStart(parsed)).line + 1;
      const location = `${displayPath(absoluteRoot, file)}:${line}`;

      if (importSource === "@tauri-apps/api" || importSource.startsWith("@tauri-apps/api/")) {
        violations.push({
          rule: "no-feature-tauri-runtime-import",
          location,
          importSource,
          message: "App and feature code must use focused src/shared/api wrappers instead of Tauri runtime imports.",
        });
        continue;
      }

      const resolvedImport = resolveImport(absoluteRoot, file, importSource);
      if (!resolvedImport) continue;
      const normalizedImport = normalizePath(resolvedImport);

      if (normalizedImport === tauriClientPath) {
        violations.push({
          rule: "no-feature-tauri-client-import",
          location,
          importSource,
          message: "App and feature code must not import src/shared/api/tauri-client directly.",
        });
        continue;
      }

      if (normalizedImport === remoteRuntimePath) {
        for (const importName of importNames(statement)) {
          if (!TRANSPORT_ONLY_REMOTE_RUNTIME_IMPORTS.has(importName)) continue;
          violations.push({
            rule: "no-feature-remote-runtime-transport-import",
            location,
            importSource,
            importName,
            message: `App and feature code must not import transport-only remote-runtime helper ${importName}.`,
          });
        }
      }
    }
  }

  return violations;
}

function printViolations(violations) {
  console.error("Frontend runtime boundary check failed:");
  for (const violation of violations) {
    const importSuffix = violation.importName ? ` (${violation.importName})` : "";
    console.error(`- ${violation.location}: ${violation.rule}${importSuffix}: ${violation.message}`);
  }
}

function isMainModule() {
  return process.argv[1] && normalizePath(fileURLToPath(import.meta.url)) === normalizePath(process.argv[1]);
}

if (isMainModule()) {
  const violations = findFrontendRuntimeBoundaryViolations();
  if (violations.length > 0) {
    printViolations(violations);
    process.exit(1);
  }
  console.log("Frontend runtime boundary check passed.");
}
