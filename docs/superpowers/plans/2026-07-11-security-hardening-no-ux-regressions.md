# Security Hardening Without UX Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the Rust master-key file and prevent future desktop-policy widening while preserving every existing remote-runtime and Pi workflow.

**Architecture:** Native secret-file permissions remain in the Rust storage secret capability. Potentially disruptive credential, transport, CSP, and asset-scope behavior is deferred; a tooling check records the current reviewed ceiling without changing runtime behavior.

**Tech Stack:** TypeScript, Zustand, Vitest, Rust, AES-GCM, Tauri, PowerShell-compatible repository scripts.

## Global Constraints

- No intentional user workflow changes or forced credential re-entry during successful migration.
- Do not block existing non-loopback HTTP or trusted-LAN/Pi configurations.
- Never log, return, or persist credentials in diagnostics.
- Preserve unrelated work and existing ciphertext compatibility.

---

### Task 1: Harden master-key permissions

**Files:**
- Modify: `src-tauri/src/commands/storage/connection_secrets.rs`

**Interfaces:**
- Produces: internal permission-hardening helpers used whenever the master key is created or loaded.
- Consumes: the existing `master_key`, `encrypt_secret`, and `decrypt_secret` flow without changing ciphertext format.

- [x] Add Unix-only failing tests asserting a new key and a pre-existing overly broad key end with mode `0600`, plus a platform-neutral encryption round-trip regression.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features connection_secrets::tests` and confirm the permission assertions fail before implementation.
- [x] Implement owner-only Unix directory/file permissions using `OpenOptions` and `PermissionsExt`, preserving Windows behavior and existing key bytes.
- [x] Rerun the focused Rust test and confirm it passes.

### Task 2: Add non-disruptive desktop security policy guardrails

**Files:**
- Create: `scripts/check-security-policy.mjs`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json` only if the check can narrow redundant scope without breaking known asset consumers.
- Modify: `docs/release-readiness-checklist.md`

**Interfaces:**
- Produces: `pnpm check:security-policy`, a check that rejects future weakening and records CSP/asset enforcement as evidence-gated follow-up work.
- Consumes: current Tauri configuration and repository check conventions.

- [x] Add the check script first so it fails on an intentionally unsupported fixture or invariant self-test.
- [x] Implement checks for explicit security configuration, documented broad-scope exceptions, and absence of accidental remote asset wildcard expansion; do not enforce a CSP that breaks current runtime behavior.
- [x] Run `pnpm check:security-policy` and `pnpm check:docs` and confirm both pass.

### Task 3: Validate and ship

**Files:**
- Review all files changed by Tasks 1-2.

- [x] Run focused Vitest and Rust tests.
- [x] Run `pnpm check:architecture`, `pnpm typecheck`, `cargo check --manifest-path src-tauri/Cargo.toml --workspace`, and `pnpm check`.
- [x] Run `git diff --check origin/main...HEAD` and inspect the complete diff for secret exposure and unrelated files.
- [ ] Run Bunny review, commit only intended files, push only to `origin`, create a draft PR, rerun Bunny after the push, wait for CI, mark ready, and merge only if all required gates are clean.
