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

Generation and Deki stage spans use stable names and contain only elapsed time, status, and bounded counts. They never include prompt text, messages, session IDs, request payloads, provider settings, or runtime details:

- `generation.prompt_assembly` with message and prompt-message counts
- `generation.first_token`
- `generation.post_save`
- `generation.background_maintenance` with the number of scheduled maintenance tasks
- `deki.session_summaries` with a session count
- `deki.active_history` with a message count

Diagnostics are opt-in, but treat exported logs as local troubleshooting material. They intentionally omit raw command arguments, request bodies, filters, row payloads, IDs, secrets, and full file paths. They can still include collection names, operation names, row counts, approximate byte sizes, cache status, timing, and error names/messages, which may reveal local workflow context. Review and redact logs before sharing them publicly.

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

Do not paste diagnostics into public issues without reviewing them first.
