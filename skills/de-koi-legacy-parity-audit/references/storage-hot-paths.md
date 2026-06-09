# Storage And Hot Paths

Load this only when the target includes `src-tauri/crates/storage`, storage
commands, catalog data, chats/messages, avatars, cold-load complaints,
projection, pagination, large payloads, or media latency.

Check:

- Embedded command path in `src-tauri/src/commands/storage` and remote `/api/invoke` routing in `src-tauri/src/http_dispatch.rs`.
- Frontend wrappers in `src/shared/api` and high-traffic consumers in `src/features`.
- Cold vs warm timings and first-open behavior for selectors, timelines, chat switching, prompt peek, and immediately visible avatars.
- `storage_get` and `storage_list` handling for projections such as `fields`, `fieldSelections`, id-only reads, filters, `before`, and pagination.
- Whether optimized projected readers are bypassed by special collection paths such as messages, characters, or managed assets.
- Large fields that should not be deserialized or returned for list/selector reads: character `data`, avatar/base64 fields, message `swipes`, `extra`, attachments, prompt snapshots, memories, and provider payload snapshots.
- JSON layout and read shape risks: pretty JSON vs compact JSON, large fields appearing before `id`, streaming lookups that deserialize nonmatching rows, and duplicated serializers with different field order.
- Media latency risks: async file URL conversion, managed-avatar resolution, cached vs uncached URL paths, `loading="lazy"` on above-the-fold avatars, and blank intermediate render states.
