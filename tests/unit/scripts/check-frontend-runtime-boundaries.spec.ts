import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFrontendRuntimeBoundaryViolations } from "../../../scripts/check-frontend-runtime-boundaries.mjs";

const fixtures = [];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "de-koi-frontend-boundaries-"));
  fixtures.push(root);
  return root;
}

function writeFixture(root, path, source) {
  const fullPath = join(root, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, source);
}

describe("frontend runtime boundary check", () => {
  afterEach(() => {
    for (const root of fixtures.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects app and feature imports of Tauri runtime modules", () => {
    const root = fixtureRoot();
    writeFixture(
      root,
      "src/features/shell/example/Bad.tsx",
      'import { invoke } from "@tauri-apps/api/core";\n',
    );

    expect(findFrontendRuntimeBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        rule: "no-feature-tauri-runtime-import",
        importSource: "@tauri-apps/api/core",
      }),
    ]);
  });

  it("rejects direct imports of the shared API Tauri client from app and feature code", () => {
    const root = fixtureRoot();
    writeFixture(root, "src/shared/api/tauri-client.ts", "export const invokeTauri = () => {};\n");
    writeFixture(
      root,
      "src/app/startup/bad.ts",
      'import { invokeTauri } from "../../shared/api/tauri-client";\n',
    );

    expect(findFrontendRuntimeBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        rule: "no-feature-tauri-client-import",
      }),
    ]);
  });

  it("rejects transport-only remote runtime imports while allowing health and settings helpers", () => {
    const root = fixtureRoot();
    writeFixture(root, "src/shared/api/remote-runtime.ts", "export const streamRemoteLlm = () => {};\n");
    writeFixture(
      root,
      "src/features/shell/settings/Remote.tsx",
      [
        'import { checkRemoteRuntimeHealth, remoteRuntimeTarget, streamRemoteLlm } from "../../../shared/api/remote-runtime";',
        'import type { RemoteRuntimeHealthCheck } from "../../../shared/api/remote-runtime";',
      ].join("\n"),
    );

    expect(findFrontendRuntimeBoundaryViolations(root)).toEqual([
      expect.objectContaining({
        rule: "no-feature-remote-runtime-transport-import",
        importName: "streamRemoteLlm",
      }),
    ]);
  });
});
