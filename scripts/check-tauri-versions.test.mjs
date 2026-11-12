import assert from "node:assert/strict";
import test from "node:test";

import { findTauriVersionMismatches, parseCargoTauriCrates, parsePnpmTauriPackages } from "./check-tauri-versions.mjs";

const pnpmLock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@tauri-apps/api':
        specifier: ^2
        version: 2.11.0
      '@tauri-apps/plugin-dialog':
        specifier: ^2.8.4
        version: 2.8.4
      react:
        specifier: ^19.3.1
        version: 19.3.1
    devDependencies:
      '@tauri-apps/cli':
        specifier: ^2
        version: 2.11.2

packages:

  '@tauri-apps/plugin-dialog@2.7.1':
    resolution: {integrity: sha512-old}
`;

const cargoLock = `[[package]]
name = "tauri"
version = "2.11.6"

[[package]]
name = "tauri-build"
version = "2.7.4"

[[package]]
name = "tauri-plugin-dialog"
version = "2.7.3"
`;

test("reads the root importer's runtime packages, not the CLI or the packages index", () => {
  assert.deepEqual(parsePnpmTauriPackages(pnpmLock), {
    "@tauri-apps/api": "2.11.0",
    "@tauri-apps/plugin-dialog": "2.8.4",
  });
});

test("reads tauri and tauri-plugin-* crates", () => {
  assert.deepEqual(parseCargoTauriCrates(cargoLock), { tauri: "2.11.6", "tauri-plugin-dialog": "2.7.3" });
});

test("reports a plugin whose minor versions differ and accepts matching pairs", () => {
  const npm = parsePnpmTauriPackages(pnpmLock);
  assert.deepEqual(findTauriVersionMismatches(npm, parseCargoTauriCrates(cargoLock)), [
    {
      npmName: "@tauri-apps/plugin-dialog",
      npmVersion: "2.8.4",
      crateName: "tauri-plugin-dialog",
      crateVersion: "2.7.3",
    },
  ]);
  assert.deepEqual(findTauriVersionMismatches(npm, { tauri: "2.11.9", "tauri-plugin-dialog": "2.8.0" }), []);
});

test("ignores a JavaScript package without a matching crate", () => {
  assert.deepEqual(findTauriVersionMismatches({ "@tauri-apps/plugin-fs": "2.4.0" }, { tauri: "2.11.0" }), []);
});
