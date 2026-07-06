# Performance Diagnostics

De-Koi performance diagnostics are opt-in and silent by default. They are meant for development builds and troubleshooting sessions where startup, storage, IPC, or frontend readiness timing needs repeatable evidence.

## Enable

Frontend diagnostics:

```text
localStorage.setItem("deKoiPerformanceDiagnostics", "1")
```

or set the build-time Vite flag:

```text
VITE_DE_KOI_PERFORMANCE_DIAGNOSTICS=1
```

Rust diagnostics:

```text
DE_KOI_PERFORMANCE_DIAGNOSTICS=1
```

The legacy-compatible Rust flag also works:

```text
MARINARA_PERFORMANCE_DIAGNOSTICS=1
```

Accepted enabled values are `1`, `true`, `yes`, and `on`.

## Output

Frontend logs use `[de-koi:perf] mark` for readiness milestones and `[de-koi:perf] span` for command timings. Rust logs use `[de-koi:perf] span` followed by a JSON object.

Milestones currently include:

- `app.boot`
- `shell.ready`
- `chat.summary-list.ready`
- `chat.message-page.ready`

IPC spans include the command name, runtime (`embedded` or `remote`), status, elapsed milliseconds, and failure name/message when a call fails. Arguments and request bodies are intentionally omitted.

Storage spans include:

- `collection`
- `operation`
- `readMode` (`projected`, `full`, or `write`)
- `rowCount`
- `approxBytes`
- `cacheHit` (`unknown` when the storage path does not expose cache state)
- `elapsedMs`
- `status`

Startup migration spans include `migrationKey`, `migrationStatus` (`run` or `skipped`), `elapsedMs`, and `status`.

Do not paste diagnostics that include private local paths into public issues without reviewing them first.
