# Audit Checklists

Load only the sections that match the parityscan target.

## Comparison Axes

Check each relevant axis, skipping only when it clearly does not apply.
In `row-only` mode, check only axes named by the row unless evidence crosses a
risky boundary. Escalate to a full axis scan only after one concrete risk appears.

- Contract/schema surface: field presence, defaults, optionality, discriminators, validation, coercion, serialized names, compatibility repair, and versioning.
- Data model relationships and downstream runtime assumptions.
- CRUD behavior: create, edit, duplicate, delete, reset, archive, favorite, enable/disable.
- Editor fields, defaults, validation, dirty-state, cancel/save behavior, and error recovery.
- Library workflows: search, filter, sort, grouping, bulk actions, selection persistence.
- Import/export: accepted formats, compatibility repair, metadata preservation, backups, conflicts, and failure messages.
- Runtime consumption: prompt assembly, mode behavior, generation effects, active selection, continuity/memory, macros, regex, lorebooks, tools, agents, or provider usage.
- Assets/media: sprites, avatars, generated images, file picking, asset copying, missing-file fallback, relative path handling, async URL resolution, visible blanks, cache behavior, and lazy-loading on immediately visible media.
- Storage and migration: old data compatibility, IDs, timestamps, schema versions, path layout, remote/embedded behavior, projected reads, filters, pagination, and large-payload avoidance.
- Performance and payload shape: cold/warm behavior, full vs projected reads, large embedded fields, serialization format, deserialization shape, and high-traffic UI latency.
- Remote/embedded parity: same command behavior and optimization through embedded Tauri, remote `/api/invoke`, shared API wrappers, and duplicated dispatch code.
- UX quality: click count, discoverability, information density, previews, undo/recovery, keyboard support, empty/loading/error states.
- Architecture and ownership: refactor separation, shared API wrapper use, hostable/runtime routing, forbidden imports, feature or contract boundaries.
- Tests/proof surfaces: existing checks, harnesses, app proof, or lack of proof around high-risk behavior.

For storage, catalog data, chats/messages, avatars, cold-load, projection,
pagination, payload, or media latency audits, load `storage-hot-paths.md`.
