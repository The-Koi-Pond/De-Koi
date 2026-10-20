import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATHS = [
  path.join(ROOT, "src-tauri", "tauri.conf.json"),
  path.join(ROOT, "src-tauri", "tauri.prealpha.conf.json"),
];
// Overlay merged over tauri.conf.json by the release workflow only. It is the one
// place allowed to turn on the signed updater.
const RELEASE_OVERLAY_PATH = path.join(ROOT, "src-tauri", "tauri.release.conf.json");
const RELEASE_UPDATER_ENDPOINT = "https://github.com/The-Koi-Pond/De-Koi/releases/latest/download/latest.json";
const MAXIMUM_ASSET_SCOPES = new Set([
  "$APPDATA/**",
  "$APPDATA/.avatar-thumbnails/**",
  "$APPDATA/.managed-thumbnails/**",
  "$APPLOCALDATA/**",
  "$APPLOCALDATA/.avatar-thumbnails/**",
  "$APPLOCALDATA/.managed-thumbnails/**",
  "$APPCONFIG/**",
  "$APPCONFIG/.avatar-thumbnails/**",
  "$APPCONFIG/.managed-thumbnails/**",
]);
const REQUIRED_CSP_SOURCES = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "blob:", "https://sdk.scdn.co"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "connect-src": ["ipc:", "http://ipc.localhost", "http:", "https:", "ws:", "wss:"],
  "img-src": ["'self'", "asset:", "http://asset.localhost", "data:", "blob:", "http:", "https:"],
  "font-src": ["'self'", "asset:", "http://asset.localhost", "data:", "blob:", "http:", "https:"],
  "media-src": ["'self'", "asset:", "http://asset.localhost", "data:", "blob:", "http:", "https:"],
  "worker-src": ["'self'", "blob:"],
  "frame-src": ["'self'", "https://www.youtube.com"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

function directiveSources(csp, directive) {
  const value = csp?.[directive];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

function cspPolicyErrors(csp, label) {
  if (!csp || typeof csp !== "object" || Array.isArray(csp)) {
    return [`${label} must be an enforced directive map, not null or a free-form value`];
  }
  const errors = [];
  for (const [directive, required] of Object.entries(REQUIRED_CSP_SOURCES)) {
    const sources = directiveSources(csp, directive);
    if (sources.includes("*")) errors.push(`${label}.${directive} must not allow wildcard sources`);
    for (const source of sources) {
      if (!required.includes(source)) errors.push(`${label}.${directive} contains unreviewed source ${source}`);
    }
    for (const source of required) {
      if (!sources.includes(source)) errors.push(`${label}.${directive} must include ${source}`);
    }
  }
  return errors;
}

export function securityPolicyErrors(config) {
  const errors = [];
  const security = config?.app?.security;
  if (!security || !("csp" in security)) errors.push("app.security.csp must be explicit");
  else errors.push(...cspPolicyErrors(security.csp, "app.security.csp"));
  if ("devCsp" in (security ?? {})) errors.push(...cspPolicyErrors(security.devCsp, "app.security.devCsp"));
  if (
    security?.dangerousDisableAssetCspModification !== undefined &&
    security.dangerousDisableAssetCspModification !== false
  ) {
    errors.push("app.security.dangerousDisableAssetCspModification must not disable Tauri CSP hardening");
  }
  if (security?.assetProtocol?.enable !== true) {
    errors.push("app.security.assetProtocol.enable must remain explicit");
  }
  const scopes = security?.assetProtocol?.scope;
  if (!Array.isArray(scopes)) {
    errors.push("app.security.assetProtocol.scope must be an array");
  } else {
    for (const scope of scopes) {
      if (!MAXIMUM_ASSET_SCOPES.has(scope)) {
        errors.push(`asset protocol scope exceeds the reviewed ceiling: ${String(scope)}`);
      }
    }
  }
  return errors;
}

// Base and pre-alpha builds must never auto-update: pre-alpha has its own identity
// and source builds update through git.
export function noUpdaterErrors(config) {
  const errors = [];
  if (config?.plugins?.updater !== undefined) errors.push("plugins.updater belongs only in tauri.release.conf.json");
  if (config?.bundle?.createUpdaterArtifacts !== undefined) {
    errors.push("bundle.createUpdaterArtifacts belongs only in tauri.release.conf.json");
  }
  return errors;
}

export function releaseOverlayErrors(overlay) {
  const errors = [];
  const allowedTopLevel = new Set(["$schema", "bundle", "plugins"]);
  for (const key of Object.keys(overlay ?? {})) {
    if (!allowedTopLevel.has(key)) errors.push(`release overlay must not override ${key}`);
  }
  for (const key of Object.keys(overlay?.bundle ?? {})) {
    if (key !== "createUpdaterArtifacts") errors.push(`release overlay must not override bundle.${key}`);
  }
  if (overlay?.bundle?.createUpdaterArtifacts !== true) {
    errors.push("release overlay must set bundle.createUpdaterArtifacts to true (v2 signed installers, no zips)");
  }
  for (const key of Object.keys(overlay?.plugins ?? {})) {
    if (key !== "updater") errors.push(`release overlay must not configure plugins.${key}`);
  }
  const updater = overlay?.plugins?.updater;
  if (!updater) return [...errors, "release overlay must configure plugins.updater"];
  for (const key of Object.keys(updater)) {
    if (key.startsWith("dangerous")) errors.push(`plugins.updater.${key} must not be set`);
  }
  const endpoints = updater.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1 || endpoints[0] !== RELEASE_UPDATER_ENDPOINT) {
    errors.push(`plugins.updater.endpoints must be exactly ["${RELEASE_UPDATER_ENDPOINT}"]`);
  }
  let keyText = "";
  try {
    keyText = Buffer.from(String(updater.pubkey ?? ""), "base64").toString("utf8");
  } catch {
    keyText = "";
  }
  if (!/^untrusted comment: minisign public key/.test(keyText)) {
    errors.push("plugins.updater.pubkey must be a base64-encoded minisign public key");
  }
  return errors;
}

function selfTest() {
  const errors = securityPolicyErrors({
    app: {
      security: {
        csp: null,
        dangerousDisableAssetCspModification: true,
        assetProtocol: { enable: true, scope: ["$HOME/**"] },
      },
    },
  });
  if (!errors.some((error) => error.includes("must be an enforced directive map"))) {
    throw new Error("missing enforced CSP check");
  }
  if (!errors.some((error) => error.includes("exceeds the reviewed ceiling"))) throw new Error("missing scope check");
  if (!errors.some((error) => error.includes("must not disable Tauri CSP hardening"))) {
    throw new Error("missing Tauri CSP hardening check");
  }

  const wildcardErrors = cspPolicyErrors(
    Object.fromEntries(
      Object.entries(REQUIRED_CSP_SOURCES).map(([directive, sources]) => [
        directive,
        directive === "connect-src" ? [...sources, "*"] : sources,
      ]),
    ),
    "app.security.csp",
  );
  if (!wildcardErrors.some((error) => error.includes("wildcard sources"))) throw new Error("missing wildcard check");

  if (noUpdaterErrors({ plugins: { updater: {} }, bundle: { createUpdaterArtifacts: true } }).length !== 2) {
    throw new Error("missing base/pre-alpha updater check");
  }
  const overlayErrors = releaseOverlayErrors({
    app: { security: { csp: null } },
    bundle: { createUpdaterArtifacts: "v1Compatible", targets: "all" },
    plugins: {
      shell: {},
      updater: {
        pubkey: "bm90IGEga2V5",
        endpoints: ["http://example.com/latest.json"],
        dangerousInsecureTransportProtocol: true,
      },
    },
  });
  for (const expected of [
    "must not override app",
    "must not override bundle.targets",
    "createUpdaterArtifacts to true",
    "must not configure plugins.shell",
    "dangerousInsecureTransportProtocol must not be set",
    "endpoints must be exactly",
    "minisign public key",
  ]) {
    if (!overlayErrors.some((error) => error.includes(expected)))
      throw new Error(`missing release overlay check: ${expected}`);
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("security policy self-test passed");
} else {
  const failures = CONFIG_PATHS.flatMap((configPath) => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return [...securityPolicyErrors(config), ...noUpdaterErrors(config)].map(
      (error) => `${path.relative(ROOT, configPath)}: ${error}`,
    );
  });
  const overlay = JSON.parse(fs.readFileSync(RELEASE_OVERLAY_PATH, "utf8"));
  failures.push(
    ...releaseOverlayErrors(overlay).map((error) => `${path.relative(ROOT, RELEASE_OVERLAY_PATH)}: ${error}`),
  );
  if (failures.length > 0) {
    console.error(failures.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `security policy check passed (CSP enforced in ${CONFIG_PATHS.length} desktop configs, release updater overlay reviewed)`,
    );
  }
}
