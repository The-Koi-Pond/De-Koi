import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
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

export function securityPolicyErrors(config) {
  const errors = [];
  const security = config?.app?.security;
  if (!security || !("csp" in security)) errors.push("app.security.csp must be explicit");
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

function selfTest() {
  const errors = securityPolicyErrors({
    app: { security: { assetProtocol: { enable: true, scope: ["$HOME/**"] } } },
  });
  if (!errors.some((error) => error.includes("csp must be explicit"))) throw new Error("missing CSP check");
  if (!errors.some((error) => error.includes("exceeds the reviewed ceiling"))) throw new Error("missing scope check");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("security policy self-test passed");
} else {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const errors = securityPolicyErrors(config);
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    const cspStatus = config.app.security.csp === null ? "compatibility exception recorded" : "configured";
    console.log(`security policy check passed (CSP: ${cspStatus})`);
  }
}
