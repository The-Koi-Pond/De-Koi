import assert from "node:assert/strict";
import test from "node:test";

import {
  globToRegExp,
  isWindowsSensitive,
  pullRequestPaths,
  stalePaths,
  uncoveredFiles,
} from "./check-windows-rust-paths.mjs";

const workflow = `name: Windows Rust Tests
on:
  pull_request:
    paths:
      - .github/workflows/windows-rust.yml
      - src-tauri/crates/sidecar/**
      - "src-tauri/crates/*/Cargo.toml"
  workflow_dispatch:
  schedule:
    - cron: "41 9 * * 1,4"
jobs:
  windows-rust:
    steps:
      - uses: actions/checkout@v7
`;

test("reads only the pull_request paths", () => {
  assert.deepEqual(pullRequestPaths(workflow), [
    ".github/workflows/windows-rust.yml",
    "src-tauri/crates/sidecar/**",
    "src-tauri/crates/*/Cargo.toml",
  ]);
});

test("matches globs the way GitHub path filters do", () => {
  assert.ok(globToRegExp("src-tauri/crates/sidecar/**").test("src-tauri/crates/sidecar/src/lib.rs"));
  assert.ok(globToRegExp("src-tauri/crates/*/Cargo.toml").test("src-tauri/crates/storage/Cargo.toml"));
  assert.ok(!globToRegExp("src-tauri/crates/*/Cargo.toml").test("src-tauri/crates/storage/sub/Cargo.toml"));
  assert.ok(!globToRegExp("src-tauri/build.rs").test("src-tauri/buildXrs"));
});

test("flags Windows-sensitive code only", () => {
  assert.ok(isWindowsSensitive("#[cfg(windows)]\nfn kill_tree() {}"));
  assert.ok(isWindowsSensitive("#[cfg(not(windows))]"));
  assert.ok(isWindowsSensitive('#[cfg(target_os = "windows")]'));
  assert.ok(isWindowsSensitive("let child = Command::new(path).spawn()?;"));
  assert.ok(isWindowsSensitive("creation_flags(CREATE_NO_WINDOW)"));
  assert.ok(isWindowsSensitive("#[cfg(any(unix, windows))]"));
  assert.ok(isWindowsSensitive("#[cfg(all(not(unix), windows))]"));
  assert.ok(isWindowsSensitive('#[cfg_attr(target_family = "windows", path = "win.rs")]'));
  assert.ok(isWindowsSensitive("if cfg!(windows) { return; }"));
  assert.ok(!isWindowsSensitive('#[cfg(all(unix, not(target_os = "macos")))]'));
  assert.ok(!isWindowsSensitive("// windows are nice\nlet window_count = 2;"));
  // Only cfg_attr's predicate counts; the attribute it applies can mention Windows.
  assert.ok(!isWindowsSensitive('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]'));
  assert.ok(!isWindowsSensitive("fn read_json(path: &Path) -> Result<Value> { todo!() }"));
});

test("reports sensitive files no path covers, and paths no file matches", () => {
  const files = new Map([
    ["src-tauri/crates/sidecar/src/lib.rs", "Command::new(binary)"],
    ["src-tauri/src/commands/storage/fonts.rs", "#[cfg(windows)]"],
    ["src-tauri/src/commands/storage/chats.rs", "fn list() {}"],
  ]);
  const paths = pullRequestPaths(workflow);

  assert.deepEqual(uncoveredFiles(files, paths), ["src-tauri/src/commands/storage/fonts.rs"]);
  assert.deepEqual(stalePaths(paths, [".github/workflows/windows-rust.yml", ...files.keys()]), [
    "src-tauri/crates/*/Cargo.toml",
  ]);
});
