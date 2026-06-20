# Legacy Marinara Storage Schema

This document describes the legacy Marinara Engine persisted data model from the local legacy checkout. It is generated from Drizzle SQLite table declarations plus the file-native storage table list.

Refresh this file with:

```sh
pnpm docs:schema:legacy
```

By default the script reads `C:\MarinaraEngine`. Use `MARINARA_ENGINE_ROOT` or `--legacy-root <path>` for another checkout.

## Source Of Truth

| Area                       | Source                                                       |
| -------------------------- | ------------------------------------------------------------ |
| Legacy schema declarations | `<legacy-root>/packages/server/src/db/schema/*.ts`           |
| File-native table list     | `<legacy-root>/packages/server/src/db/file-backed-store.ts`  |
| Runtime storage config     | `<legacy-root>/packages/server/src/config/runtime-config.ts` |

## Storage Model

Legacy Marinara v1.5.7+ uses file-native storage by default. Tables are kept in memory and persisted as JSON snapshots under:

```text
DATA_DIR/storage/tables/<table>.json
DATA_DIR/storage/manifest.json
```

The Drizzle SQLite schema still defines the table and column contract. SQLite is kept as an opt-in compatibility backend and as the source format for one-time import from older `marinara-engine.db` files.

## Table Catalog

| Table                      | Drizzle export           | File-backed | Columns | Primary key | De-Koi target                                   | Comparison notes                                                                                                 |
| -------------------------- | ------------------------ | ----------- | ------- | ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `chats`                    | `chats`                  | yes         | 14      | `id`        | `chats`                                         | Legacy stores `visual_novel` as a mode enum; De-Koi accepts it as an import/runtime alias for roleplay.          |
| `messages`                 | `messages`               | yes         | 8       | `id`        | `messages`                                      | Legacy stores `extra` as JSON text; De-Koi keeps message extras as JSON objects and materializes swipe sidecars. |
| `message_swipes`           | `messageSwipes`          | yes         | 6       | `id`        | `message-swipes`                                | Legacy has no denormalized `chatId`; De-Koi sidecars include it.                                                 |
| `characters`               | `characters`             | yes         | 7       | `id`        | `characters`                                    | CharacterData V2 JSON is the durable payload in both systems.                                                    |
| `character_card_versions`  | `characterCardVersions`  | yes         | 9       | `id`        | `character-versions`                            | Character snapshot history.                                                                                      |
| `personas`                 | `personas`               | yes         | 21      | `id`        | `personas`                                      | Persona fields are mostly first-class columns in legacy and object fields in De-Koi.                             |
| `character_groups`         | `characterGroups`        | yes         | 7       | `id`        | `character-groups`                              | Stores character IDs as a JSON array.                                                                            |
| `persona_groups`           | `personaGroups`          | yes         | 6       | `id`        | `persona-groups`                                | Stores persona IDs as a JSON array.                                                                              |
| `lorebooks`                | `lorebooks`              | yes         | 21      | `id`        | `lorebooks`                                     | Legacy also has link tables for character/persona scope.                                                         |
| `lorebook_character_links` | `lorebookCharacterLinks` | yes         | 4       | `id`        | `lorebooks` scope data                          | Legacy join table; De-Koi import/profile flows collapse scope into lorebook-compatible JSON fields.              |
| `lorebook_persona_links`   | `lorebookPersonaLinks`   | yes         | 4       | `id`        | `lorebooks` scope data                          | Legacy join table; De-Koi import/profile flows collapse scope into lorebook-compatible JSON fields.              |
| `lorebook_folders`         | `lorebookFolders`        | yes         | 8       | `id`        | `lorebook-folders`                              | Folder rows remain a separate collection.                                                                        |
| `lorebook_entries`         | `lorebookEntries`        | yes         | 45      | `id`        | `lorebook-entries`                              | Entry fields are close to De-Koi, with JSON text columns normalized on import.                                   |
| `prompt_presets`           | `promptPresets`          | yes         | 14      | `id`        | `prompts`                                       | Legacy table name differs from De-Koi's collection name.                                                         |
| `prompt_groups`            | `promptGroups`           | yes         | 7       | `id`        | `prompt-groups`                                 | Prompt preset child table.                                                                                       |
| `prompt_sections`          | `promptSections`         | yes         | 16      | `id`        | `prompt-sections`                               | Contains legacy wrapping columns that De-Koi preserves as compatibility data where relevant.                     |
| `choice_blocks`            | `choiceBlocks`           | yes         | 10      | `id`        | `prompt-variables`                              | Legacy choice blocks become prompt variables in De-Koi.                                                          |
| `api_connections`          | `apiConnections`         | yes         | 30      | `id`        | `connections`                                   | Secrets and provider-specific fields need special handling during profile import/export.                         |
| `assets`                   | `assets`                 | yes         | 7       | `id`        | `background-metadata`, `sprites`, managed files | Legacy combines background and sprite asset metadata in one table.                                               |
| `agent_configs`            | `agentConfigs`           | yes         | 12      | `id`        | `agents`                                        | Legacy custom script-tool affordances are intentionally unsupported in De-Koi execution.                         |
| `agent_runs`               | `agentRuns`              | yes         | 11      | `id`        | `agent-runs`                                    | Legacy snake_case row shape is accepted by De-Koi repair/import paths.                                           |
| `agent_memory`             | `agentMemory`            | yes         | 6       | `id`        | `agent-memory`                                  | Per-agent, per-chat key/value state.                                                                             |
| `custom_tools`             | `customTools`            | yes         | 11      | `id`        | `custom-tools`                                  | Legacy script tools are preserved for review but cannot execute in De-Koi.                                       |
| `game_state_snapshots`     | `gameStateSnapshots`     | yes         | 17      | `id`        | `game-state-snapshots`                          | Per-message/swipe tracker state.                                                                                 |
| `game_checkpoints`         | `gameCheckpoints`        | yes         | 12      | `id`        | `game-checkpoints`                              | Game rollback/checkpoint rows.                                                                                   |
| `regex_scripts`            | `regexScripts`           | yes         | 15      | `id`        | `regex-scripts`                                 | Find/replace script rows.                                                                                        |
| `chat_images`              | `chatImages`             | yes         | 9       | `id`        | `gallery`                                       | Legacy chat images map to De-Koi shared/chat gallery rows and managed gallery files.                             |
| `character_images`         | `characterImages`        | yes         | 9       | `id`        | `character-gallery`                             | Legacy character images map to character gallery rows and managed gallery files.                                 |
| `ooc_influences`           | `oocInfluences`          | yes         | 7       | `id`        | `chats.notes[]`                                 | Imported as embedded one-shot influence notes on the target chat.                                                |
| `conversation_notes`       | `conversationNotes`      | yes         | 6       | `id`        | `chats.notes[]`                                 | Imported as embedded durable conversation notes on the target chat.                                              |
| `memory_chunks`            | `memoryChunks`           | yes         | 9       | `id`        | `chats.memories[]`                              | Imported as embedded memory chunks; De-Koi has no standalone `chat-memory` collection.                           |
| `chat_folders`             | `chatFolders`            | yes         | 8       | `id`        | `chat-folders`                                  | Folder rows remain a separate collection.                                                                        |
| `api_connection_folders`   | `apiConnectionFolders`   | yes         | 7       | `id`        | `connection-folders`                            | Folder rows remain a separate collection.                                                                        |
| `custom_themes`            | `customThemes`           | yes         | 7       | `id`        | `themes`                                        | Legacy table name differs from De-Koi's collection name.                                                         |
| `app_settings`             | `appSettings`            | yes         | 3       | `key`       | `app-settings`                                  | Loose settings key/value payload.                                                                                |
| `chat_presets`             | `chatPresets`            | yes         | 8       | `id`        | `chat-presets`                                  | Reusable mode/generation defaults.                                                                               |
| `prompt_overrides`         | `promptOverrides`        | yes         | 4       | `key`       | `prompt-overrides`                              | Compatibility rows for prompt-section override behavior.                                                         |
| `installed_extensions`     | `installedExtensions`    | yes         | 9       | `id`        | `extensions`                                    | Imported extension rows are disabled by De-Koi profile import.                                                   |

## File-Native Delete Cascades

The file-backed store emulates important SQLite cascades in source code.

| Parent table     | Child table                | Key mapping           |
| ---------------- | -------------------------- | --------------------- |
| `chats`          | `messages`                 | `id -> chatId`        |
| `chats`          | `agent_runs`               | `id -> chatId`        |
| `chats`          | `agent_memory`             | `id -> chatId`        |
| `chats`          | `chat_images`              | `id -> chatId`        |
| `chats`          | `memory_chunks`            | `id -> chatId`        |
| `chats`          | `game_state_snapshots`     | `id -> chatId`        |
| `chats`          | `game_checkpoints`         | `id -> chatId`        |
| `messages`       | `message_swipes`           | `id -> messageId`     |
| `characters`     | `character_card_versions`  | `id -> characterId`   |
| `characters`     | `character_images`         | `id -> characterId`   |
| `lorebooks`      | `lorebook_character_links` | `id -> lorebookId`    |
| `lorebooks`      | `lorebook_persona_links`   | `id -> lorebookId`    |
| `lorebooks`      | `lorebook_folders`         | `id -> lorebookId`    |
| `lorebooks`      | `lorebook_entries`         | `id -> lorebookId`    |
| `prompt_presets` | `prompt_groups`            | `id -> presetId`      |
| `prompt_presets` | `prompt_sections`          | `id -> presetId`      |
| `prompt_presets` | `choice_blocks`            | `id -> presetId`      |
| `agent_configs`  | `agent_runs`               | `id -> agentConfigId` |
| `agent_configs`  | `agent_memory`             | `id -> agentConfigId` |

## Unique Indexes

| Table                      | Index                                | Columns                     |
| -------------------------- | ------------------------------------ | --------------------------- |
| `lorebook_character_links` | `uniq_lorebook_character_links_pair` | `lorebookId`, `characterId` |
| `lorebook_persona_links`   | `uniq_lorebook_persona_links_pair`   | `lorebookId`, `personaId`   |

## De-Koi-Only Comparison Rows

These De-Koi collections do not have a direct legacy table equivalent in the parsed schema.

| De-Koi collection     | Why it matters                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- |
| `persona-gallery`     | De-Koi adds a persona-owned gallery split from legacy's chat/character image tables.    |
| `global-gallery`      | De-Koi adds a global gallery split from legacy's chat/character image tables.           |
| `gallery-folders`     | De-Koi adds gallery folders; legacy image tables have no folder table.                  |
| `plugin-memory`       | De-Koi adds namespaced plugin key/value storage.                                        |
| `knowledge-sources`   | De-Koi tracks knowledge-source metadata outside the legacy Drizzle tables.              |
| `background-metadata` | De-Koi splits background metadata from legacy's mixed `assets` table.                   |
| `sprites`             | De-Koi keeps sprite compatibility metadata separate from legacy's mixed `assets` table. |

## Column Catalog

### chats

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key               | DB column           | Type    | Nullable | Primary | Default | Enum                                               | Reference |
| ----------------- | ------------------- | ------- | -------- | ------- | ------- | -------------------------------------------------- | --------- |
| `id`              | `id`                | text    | no       | yes     | -       | -                                                  | -         |
| `name`            | `name`              | text    | no       | -       | -       | -                                                  | -         |
| `mode`            | `mode`              | text    | no       | -       | -       | `conversation`, `roleplay`, `visual_novel`, `game` | -         |
| `characterIds`    | `character_ids`     | text    | no       | -       | `"[]"`  | -                                                  | -         |
| `groupId`         | `group_id`          | text    | yes      | -       | -       | -                                                  | -         |
| `personaId`       | `persona_id`        | text    | yes      | -       | -       | -                                                  | -         |
| `promptPresetId`  | `prompt_preset_id`  | text    | yes      | -       | -       | -                                                  | -         |
| `connectionId`    | `connection_id`     | text    | yes      | -       | -       | -                                                  | -         |
| `metadata`        | `metadata`          | text    | no       | -       | `"{}"`  | -                                                  | -         |
| `connectedChatId` | `connected_chat_id` | text    | yes      | -       | -       | -                                                  | -         |
| `folderId`        | `folder_id`         | text    | yes      | -       | -       | -                                                  | -         |
| `sortOrder`       | `sort_order`        | integer | no       | -       | `0`     | -                                                  | -         |
| `createdAt`       | `created_at`        | text    | no       | -       | -       | -                                                  | -         |
| `updatedAt`       | `updated_at`        | text    | no       | -       | -       | -                                                  | -         |

### messages

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key                | DB column            | Type    | Nullable | Primary | Default | Enum                                      | Reference                    |
| ------------------ | -------------------- | ------- | -------- | ------- | ------- | ----------------------------------------- | ---------------------------- |
| `id`               | `id`                 | text    | no       | yes     | -       | -                                         | -                            |
| `chatId`           | `chat_id`            | text    | no       | -       | -       | -                                         | `chats.id` on delete cascade |
| `role`             | `role`               | text    | no       | -       | -       | `user`, `assistant`, `system`, `narrator` | -                            |
| `characterId`      | `character_id`       | text    | yes      | -       | -       | -                                         | -                            |
| `content`          | `content`            | text    | no       | -       | `""`    | -                                         | -                            |
| `activeSwipeIndex` | `active_swipe_index` | integer | no       | -       | `0`     | -                                         | -                            |
| `extra`            | `extra`              | text    | no       | -       | `"{}"`  | -                                         | -                            |
| `createdAt`        | `created_at`         | text    | no       | -       | -       | -                                         | -                            |

### message_swipes

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key         | DB column    | Type    | Nullable | Primary | Default | Enum | Reference                       |
| ----------- | ------------ | ------- | -------- | ------- | ------- | ---- | ------------------------------- |
| `id`        | `id`         | text    | no       | yes     | -       | -    | -                               |
| `messageId` | `message_id` | text    | no       | -       | -       | -    | `messages.id` on delete cascade |
| `index`     | `index`      | integer | no       | -       | -       | -    | -                               |
| `content`   | `content`    | text    | no       | -       | `""`    | -    | -                               |
| `extra`     | `extra`      | text    | no       | -       | `"{}"`  | -    | -                               |
| `createdAt` | `created_at` | text    | no       | -       | -       | -    | -                               |

### characters

Source: `<legacy-root>/packages/server/src/db/schema/characters.ts`

| Key                | DB column            | Type | Nullable | Primary | Default | Enum | Reference |
| ------------------ | -------------------- | ---- | -------- | ------- | ------- | ---- | --------- |
| `id`               | `id`                 | text | no       | yes     | -       | -    | -         |
| `data`             | `data`               | text | no       | -       | -       | -    | -         |
| `comment`          | `comment`            | text | no       | -       | `""`    | -    | -         |
| `avatarPath`       | `avatar_path`        | text | yes      | -       | -       | -    | -         |
| `spriteFolderPath` | `sprite_folder_path` | text | yes      | -       | -       | -    | -         |
| `createdAt`        | `created_at`         | text | no       | -       | -       | -    | -         |
| `updatedAt`        | `updated_at`         | text | no       | -       | -       | -    | -         |

### character_card_versions

Source: `<legacy-root>/packages/server/src/db/schema/characters.ts`

| Key           | DB column      | Type | Nullable | Primary | Default    | Enum | Reference                         |
| ------------- | -------------- | ---- | -------- | ------- | ---------- | ---- | --------------------------------- |
| `id`          | `id`           | text | no       | yes     | -          | -    | -                                 |
| `characterId` | `character_id` | text | no       | -       | -          | -    | `characters.id` on delete cascade |
| `data`        | `data`         | text | no       | -       | -          | -    | -                                 |
| `comment`     | `comment`      | text | no       | -       | `""`       | -    | -                                 |
| `avatarPath`  | `avatar_path`  | text | yes      | -       | -          | -    | -                                 |
| `version`     | `version`      | text | no       | -       | `""`       | -    | -                                 |
| `source`      | `source`       | text | no       | -       | `"manual"` | -    | -                                 |
| `reason`      | `reason`       | text | no       | -       | `""`       | -    | -                                 |
| `createdAt`   | `created_at`   | text | no       | -       | -          | -    | -                                 |

### personas

Source: `<legacy-root>/packages/server/src/db/schema/characters.ts`

| Key                  | DB column              | Type | Nullable | Primary | Default             | Enum | Reference |
| -------------------- | ---------------------- | ---- | -------- | ------- | ------------------- | ---- | --------- |
| `id`                 | `id`                   | text | no       | yes     | -                   | -    | -         |
| `name`               | `name`                 | text | no       | -       | -                   | -    | -         |
| `comment`            | `comment`              | text | no       | -       | `""`                | -    | -         |
| `description`        | `description`          | text | no       | -       | `""`                | -    | -         |
| `personality`        | `personality`          | text | no       | -       | `""`                | -    | -         |
| `scenario`           | `scenario`             | text | no       | -       | `""`                | -    | -         |
| `backstory`          | `backstory`            | text | no       | -       | `""`                | -    | -         |
| `appearance`         | `appearance`           | text | no       | -       | `""`                | -    | -         |
| `avatarPath`         | `avatar_path`          | text | yes      | -       | -                   | -    | -         |
| `avatarCrop`         | `avatar_crop`          | text | no       | -       | `""`                | -    | -         |
| `isActive`           | `is_active`            | text | no       | -       | `"false"`           | -    | -         |
| `nameColor`          | `name_color`           | text | no       | -       | `""`                | -    | -         |
| `dialogueColor`      | `dialogue_color`       | text | no       | -       | `""`                | -    | -         |
| `boxColor`           | `box_color`            | text | no       | -       | `""`                | -    | -         |
| `trackerCardColors`  | `tracker_card_colors`  | text | no       | -       | `'{"mode":"chat"}'` | -    | -         |
| `personaStats`       | `persona_stats`        | text | no       | -       | `""`                | -    | -         |
| `altDescriptions`    | `alt_descriptions`     | text | no       | -       | `"[]"`              | -    | -         |
| `tags`               | `tags`                 | text | no       | -       | `"[]"`              | -    | -         |
| `savedStatusOptions` | `saved_status_options` | text | no       | -       | `"[]"`              | -    | -         |
| `createdAt`          | `created_at`           | text | no       | -       | -                   | -    | -         |
| `updatedAt`          | `updated_at`           | text | no       | -       | -                   | -    | -         |

### character_groups

Source: `<legacy-root>/packages/server/src/db/schema/characters.ts`

| Key            | DB column       | Type | Nullable | Primary | Default | Enum | Reference |
| -------------- | --------------- | ---- | -------- | ------- | ------- | ---- | --------- |
| `id`           | `id`            | text | no       | yes     | -       | -    | -         |
| `name`         | `name`          | text | no       | -       | -       | -    | -         |
| `description`  | `description`   | text | no       | -       | `""`    | -    | -         |
| `avatarPath`   | `avatar_path`   | text | yes      | -       | -       | -    | -         |
| `characterIds` | `character_ids` | text | no       | -       | `"[]"`  | -    | -         |
| `createdAt`    | `created_at`    | text | no       | -       | -       | -    | -         |
| `updatedAt`    | `updated_at`    | text | no       | -       | -       | -    | -         |

### persona_groups

Source: `<legacy-root>/packages/server/src/db/schema/characters.ts`

| Key           | DB column     | Type | Nullable | Primary | Default | Enum | Reference |
| ------------- | ------------- | ---- | -------- | ------- | ------- | ---- | --------- |
| `id`          | `id`          | text | no       | yes     | -       | -    | -         |
| `name`        | `name`        | text | no       | -       | -       | -    | -         |
| `description` | `description` | text | no       | -       | `""`    | -    | -         |
| `personaIds`  | `persona_ids` | text | no       | -       | `"[]"`  | -    | -         |
| `createdAt`   | `created_at`  | text | no       | -       | -       | -    | -         |
| `updatedAt`   | `updated_at`  | text | no       | -       | -       | -    | -         |

### lorebooks

Source: `<legacy-root>/packages/server/src/db/schema/lorebooks.ts`

| Key                        | DB column                    | Type    | Nullable | Primary | Default                         | Enum | Reference |
| -------------------------- | ---------------------------- | ------- | -------- | ------- | ------------------------------- | ---- | --------- |
| `id`                       | `id`                         | text    | no       | yes     | -                               | -    | -         |
| `name`                     | `name`                       | text    | no       | -       | -                               | -    | -         |
| `description`              | `description`                | text    | no       | -       | `""`                            | -    | -         |
| `category`                 | `category`                   | text    | no       | -       | `"uncategorized"`               | -    | -         |
| `imagePath`                | `image_path`                 | text    | yes      | -       | -                               | -    | -         |
| `scanDepth`                | `scan_depth`                 | integer | no       | -       | `2`                             | -    | -         |
| `tokenBudget`              | `token_budget`               | integer | no       | -       | `2048`                          | -    | -         |
| `recursiveScanning`        | `recursive_scanning`         | text    | no       | -       | `"false"`                       | -    | -         |
| `maxRecursionDepth`        | `max_recursion_depth`        | integer | no       | -       | `3`                             | -    | -         |
| `excludeFromVectorization` | `exclude_from_vectorization` | text    | no       | -       | `"false"`                       | -    | -         |
| `characterId`              | `character_id`               | text    | yes      | -       | -                               | -    | -         |
| `personaId`                | `persona_id`                 | text    | yes      | -       | -                               | -    | -         |
| `chatId`                   | `chat_id`                    | text    | yes      | -       | -                               | -    | -         |
| `isGlobal`                 | `is_global`                  | text    | no       | -       | `"false"`                       | -    | -         |
| `enabled`                  | `enabled`                    | text    | no       | -       | `"true"`                        | -    | -         |
| `scope`                    | `scope`                      | text    | no       | -       | `'{"mode":"all","chatIds":[]}'` | -    | -         |
| `tags`                     | `tags`                       | text    | no       | -       | `"[]"`                          | -    | -         |
| `generatedBy`              | `generated_by`               | text    | yes      | -       | -                               | -    | -         |
| `sourceAgentId`            | `source_agent_id`            | text    | yes      | -       | -                               | -    | -         |
| `createdAt`                | `created_at`                 | text    | no       | -       | -                               | -    | -         |
| `updatedAt`                | `updated_at`                 | text    | no       | -       | -                               | -    | -         |

### lorebook_character_links

Source: `<legacy-root>/packages/server/src/db/schema/lorebooks.ts`

| Key           | DB column      | Type | Nullable | Primary | Default | Enum | Reference                        |
| ------------- | -------------- | ---- | -------- | ------- | ------- | ---- | -------------------------------- |
| `id`          | `id`           | text | no       | yes     | -       | -    | -                                |
| `lorebookId`  | `lorebook_id`  | text | no       | -       | -       | -    | `lorebooks.id` on delete cascade |
| `characterId` | `character_id` | text | no       | -       | -       | -    | -                                |
| `createdAt`   | `created_at`   | text | no       | -       | -       | -    | -                                |

### lorebook_persona_links

Source: `<legacy-root>/packages/server/src/db/schema/lorebooks.ts`

| Key          | DB column     | Type | Nullable | Primary | Default | Enum | Reference                        |
| ------------ | ------------- | ---- | -------- | ------- | ------- | ---- | -------------------------------- |
| `id`         | `id`          | text | no       | yes     | -       | -    | -                                |
| `lorebookId` | `lorebook_id` | text | no       | -       | -       | -    | `lorebooks.id` on delete cascade |
| `personaId`  | `persona_id`  | text | no       | -       | -       | -    | -                                |
| `createdAt`  | `created_at`  | text | no       | -       | -       | -    | -                                |

### lorebook_folders

Source: `<legacy-root>/packages/server/src/db/schema/lorebooks.ts`

| Key              | DB column          | Type    | Nullable | Primary | Default  | Enum | Reference                        |
| ---------------- | ------------------ | ------- | -------- | ------- | -------- | ---- | -------------------------------- |
| `id`             | `id`               | text    | no       | yes     | -        | -    | -                                |
| `lorebookId`     | `lorebook_id`      | text    | no       | -       | -        | -    | `lorebooks.id` on delete cascade |
| `name`           | `name`             | text    | no       | -       | -        | -    | -                                |
| `enabled`        | `enabled`          | text    | no       | -       | `"true"` | -    | -                                |
| `parentFolderId` | `parent_folder_id` | text    | yes      | -       | -        | -    | -                                |
| `order`          | `order`            | integer | no       | -       | `0`      | -    | -                                |
| `createdAt`      | `created_at`       | text    | no       | -       | -        | -    | -                                |
| `updatedAt`      | `updated_at`       | text    | no       | -       | -        | -    | -                                |

### lorebook_entries

Source: `<legacy-root>/packages/server/src/db/schema/lorebooks.ts`

| Key                           | DB column                        | Type    | Nullable | Primary | Default    | Enum                          | Reference                        |
| ----------------------------- | -------------------------------- | ------- | -------- | ------- | ---------- | ----------------------------- | -------------------------------- |
| `id`                          | `id`                             | text    | no       | yes     | -          | -                             | -                                |
| `lorebookId`                  | `lorebook_id`                    | text    | no       | -       | -          | -                             | `lorebooks.id` on delete cascade |
| `folderId`                    | `folder_id`                      | text    | yes      | -       | -          | -                             | -                                |
| `name`                        | `name`                           | text    | no       | -       | -          | -                             | -                                |
| `content`                     | `content`                        | text    | no       | -       | `""`       | -                             | -                                |
| `description`                 | `description`                    | text    | no       | -       | `""`       | -                             | -                                |
| `keys`                        | `keys`                           | text    | no       | -       | `"[]"`     | -                             | -                                |
| `secondaryKeys`               | `secondary_keys`                 | text    | no       | -       | `"[]"`     | -                             | -                                |
| `enabled`                     | `enabled`                        | text    | no       | -       | `"true"`   | -                             | -                                |
| `constant`                    | `constant`                       | text    | no       | -       | `"false"`  | -                             | -                                |
| `selective`                   | `selective`                      | text    | no       | -       | `"false"`  | -                             | -                                |
| `selectiveLogic`              | `selective_logic`                | text    | no       | -       | `"and"`    | `and`, `or`, `not`            | -                                |
| `probability`                 | `probability`                    | integer | yes      | -       | -          | -                             | -                                |
| `scanDepth`                   | `scan_depth`                     | integer | yes      | -       | -          | -                             | -                                |
| `matchWholeWords`             | `match_whole_words`              | text    | no       | -       | `"false"`  | -                             | -                                |
| `caseSensitive`               | `case_sensitive`                 | text    | no       | -       | `"false"`  | -                             | -                                |
| `useRegex`                    | `use_regex`                      | text    | no       | -       | `"false"`  | -                             | -                                |
| `characterFilterMode`         | `character_filter_mode`          | text    | no       | -       | `"any"`    | `any`, `include`, `exclude`   | -                                |
| `characterFilterIds`          | `character_filter_ids`           | text    | no       | -       | `"[]"`     | -                             | -                                |
| `characterTagFilterMode`      | `character_tag_filter_mode`      | text    | no       | -       | `"any"`    | `any`, `include`, `exclude`   | -                                |
| `characterTagFilters`         | `character_tag_filters`          | text    | no       | -       | `"[]"`     | -                             | -                                |
| `generationTriggerFilterMode` | `generation_trigger_filter_mode` | text    | no       | -       | `"any"`    | `any`, `include`, `exclude`   | -                                |
| `generationTriggerFilters`    | `generation_trigger_filters`     | text    | no       | -       | `"[]"`     | -                             | -                                |
| `additionalMatchingSources`   | `additional_matching_sources`    | text    | no       | -       | `"[]"`     | -                             | -                                |
| `position`                    | `position`                       | integer | no       | -       | `0`        | -                             | -                                |
| `depth`                       | `depth`                          | integer | no       | -       | `4`        | -                             | -                                |
| `order`                       | `order`                          | integer | no       | -       | `100`      | -                             | -                                |
| `role`                        | `role`                           | text    | no       | -       | `"system"` | `system`, `user`, `assistant` | -                                |
| `sticky`                      | `sticky`                         | integer | yes      | -       | -          | -                             | -                                |
| `cooldown`                    | `cooldown`                       | integer | yes      | -       | -          | -                             | -                                |
| `delay`                       | `delay`                          | integer | yes      | -       | -          | -                             | -                                |
| `ephemeral`                   | `ephemeral`                      | integer | yes      | -       | -          | -                             | -                                |
| `group`                       | `group`                          | text    | no       | -       | `""`       | -                             | -                                |
| `groupWeight`                 | `group_weight`                   | integer | yes      | -       | -          | -                             | -                                |
| `locked`                      | `locked`                         | text    | no       | -       | `"false"`  | -                             | -                                |
| `tag`                         | `tag`                            | text    | no       | -       | `""`       | -                             | -                                |
| `relationships`               | `relationships`                  | text    | no       | -       | `"{}"`     | -                             | -                                |
| `dynamicState`                | `dynamic_state`                  | text    | no       | -       | `"{}"`     | -                             | -                                |
| `activationConditions`        | `activation_conditions`          | text    | no       | -       | `"[]"`     | -                             | -                                |
| `schedule`                    | `schedule`                       | text    | yes      | -       | -          | -                             | -                                |
| `preventRecursion`            | `prevent_recursion`              | text    | no       | -       | `"false"`  | -                             | -                                |
| `excludeFromVectorization`    | `exclude_from_vectorization`     | text    | no       | -       | `"false"`  | -                             | -                                |
| `embedding`                   | `embedding`                      | text    | yes      | -       | -          | -                             | -                                |
| `createdAt`                   | `created_at`                     | text    | no       | -       | -          | -                             | -                                |
| `updatedAt`                   | `updated_at`                     | text    | no       | -       | -          | -                             | -                                |

### prompt_presets

Source: `<legacy-root>/packages/server/src/db/schema/prompts.ts`

| Key              | DB column         | Type | Nullable | Primary | Default   | Enum | Reference |
| ---------------- | ----------------- | ---- | -------- | ------- | --------- | ---- | --------- |
| `id`             | `id`              | text | no       | yes     | -         | -    | -         |
| `name`           | `name`            | text | no       | -       | -         | -    | -         |
| `description`    | `description`     | text | no       | -       | `""`      | -    | -         |
| `sectionOrder`   | `section_order`   | text | no       | -       | `"[]"`    | -    | -         |
| `groupOrder`     | `group_order`     | text | no       | -       | `"[]"`    | -    | -         |
| `variableGroups` | `variable_groups` | text | no       | -       | `"[]"`    | -    | -         |
| `variableValues` | `variable_values` | text | no       | -       | `"{}"`    | -    | -         |
| `parameters`     | `parameters`      | text | no       | -       | `"{}"`    | -    | -         |
| `wrapFormat`     | `wrap_format`     | text | no       | -       | `"xml"`   | -    | -         |
| `defaultChoices` | `default_choices` | text | no       | -       | `"{}"`    | -    | -         |
| `isDefault`      | `is_default`      | text | no       | -       | `"false"` | -    | -         |
| `author`         | `author`          | text | no       | -       | `""`      | -    | -         |
| `createdAt`      | `created_at`      | text | no       | -       | -         | -    | -         |
| `updatedAt`      | `updated_at`      | text | no       | -       | -         | -    | -         |

### prompt_groups

Source: `<legacy-root>/packages/server/src/db/schema/prompts.ts`

| Key             | DB column         | Type    | Nullable | Primary | Default  | Enum | Reference                             |
| --------------- | ----------------- | ------- | -------- | ------- | -------- | ---- | ------------------------------------- |
| `id`            | `id`              | text    | no       | yes     | -        | -    | -                                     |
| `presetId`      | `preset_id`       | text    | no       | -       | -        | -    | `prompt_presets.id` on delete cascade |
| `name`          | `name`            | text    | no       | -       | -        | -    | -                                     |
| `parentGroupId` | `parent_group_id` | text    | yes      | -       | -        | -    | -                                     |
| `order`         | `order`           | integer | no       | -       | `100`    | -    | -                                     |
| `enabled`       | `enabled`         | text    | no       | -       | `"true"` | -    | -                                     |
| `createdAt`     | `created_at`      | text    | no       | -       | -        | -    | -                                     |

### prompt_sections

Source: `<legacy-root>/packages/server/src/db/schema/prompts.ts`

| Key                 | DB column            | Type    | Nullable | Primary | Default     | Enum                          | Reference                             |
| ------------------- | -------------------- | ------- | -------- | ------- | ----------- | ----------------------------- | ------------------------------------- |
| `id`                | `id`                 | text    | no       | yes     | -           | -                             | -                                     |
| `presetId`          | `preset_id`          | text    | no       | -       | -           | -                             | `prompt_presets.id` on delete cascade |
| `identifier`        | `identifier`         | text    | no       | -       | -           | -                             | -                                     |
| `name`              | `name`               | text    | no       | -       | -           | -                             | -                                     |
| `content`           | `content`            | text    | no       | -       | `""`        | -                             | -                                     |
| `role`              | `role`               | text    | no       | -       | `"system"`  | `system`, `user`, `assistant` | -                                     |
| `enabled`           | `enabled`            | text    | no       | -       | `"true"`    | -                             | -                                     |
| `isMarker`          | `is_marker`          | text    | no       | -       | `"false"`   | -                             | -                                     |
| `groupId`           | `group_id`           | text    | yes      | -       | -           | -                             | -                                     |
| `markerConfig`      | `marker_config`      | text    | yes      | -       | -           | -                             | -                                     |
| `injectionPosition` | `injection_position` | text    | no       | -       | `"ordered"` | `ordered`, `depth`            | -                                     |
| `injectionDepth`    | `injection_depth`    | integer | no       | -       | `0`         | -                             | -                                     |
| `injectionOrder`    | `injection_order`    | integer | no       | -       | `100`       | -                             | -                                     |
| `wrapInXml`         | `wrap_in_xml`        | text    | no       | -       | `"false"`   | -                             | -                                     |
| `xmlTagName`        | `xml_tag_name`       | text    | no       | -       | `""`        | -                             | -                                     |
| `forbidOverrides`   | `forbid_overrides`   | text    | no       | -       | `"false"`   | -                             | -                                     |

### choice_blocks

Source: `<legacy-root>/packages/server/src/db/schema/prompts.ts`

| Key            | DB column       | Type    | Nullable | Primary | Default   | Enum | Reference                             |
| -------------- | --------------- | ------- | -------- | ------- | --------- | ---- | ------------------------------------- |
| `id`           | `id`            | text    | no       | yes     | -         | -    | -                                     |
| `presetId`     | `preset_id`     | text    | no       | -       | -         | -    | `prompt_presets.id` on delete cascade |
| `variableName` | `variable_name` | text    | no       | -       | -         | -    | -                                     |
| `question`     | `question`      | text    | no       | -       | -         | -    | -                                     |
| `options`      | `options`       | text    | no       | -       | `"[]"`    | -    | -                                     |
| `multiSelect`  | `multi_select`  | text    | no       | -       | `"false"` | -    | -                                     |
| `separator`    | `separator`     | text    | no       | -       | `", "`    | -    | -                                     |
| `randomPick`   | `random_pick`   | text    | no       | -       | `"false"` | -    | -                                     |
| `sortOrder`    | `sort_order`    | integer | no       | -       | `0`       | -    | -                                     |
| `createdAt`    | `created_at`    | text    | no       | -       | -         | -    | -                                     |

### api_connections

Source: `<legacy-root>/packages/server/src/db/schema/connections.ts`

| Key                     | DB column                 | Type    | Nullable | Primary | Default   | Enum                                                                                                                                                                         | Reference |
| ----------------------- | ------------------------- | ------- | -------- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `id`                    | `id`                      | text    | no       | yes     | -         | -                                                                                                                                                                            | -         |
| `name`                  | `name`                    | text    | no       | -       | -         | -                                                                                                                                                                            | -         |
| `provider`              | `provider`                | text    | no       | -       | -         | `openai`, `openai_chatgpt`, `anthropic`, `claude_subscription`, `google`, `google_vertex`, `mistral`, `cohere`, `openrouter`, `nanogpt`, `xai`, `custom`, `image_generation` | -         |
| `baseUrl`               | `base_url`                | text    | no       | -       | `""`      | -                                                                                                                                                                            | -         |
| `apiKeyEncrypted`       | `api_key_encrypted`       | text    | no       | -       | `""`      | -                                                                                                                                                                            | -         |
| `model`                 | `model`                   | text    | no       | -       | `""`      | -                                                                                                                                                                            | -         |
| `imagePath`             | `image_path`              | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `maxContext`            | `max_context`             | integer | no       | -       | `128000`  | -                                                                                                                                                                            | -         |
| `isDefault`             | `is_default`              | text    | no       | -       | `"false"` | -                                                                                                                                                                            | -         |
| `useForRandom`          | `use_for_random`          | text    | no       | -       | `"false"` | -                                                                                                                                                                            | -         |
| `enableCaching`         | `enable_caching`          | text    | no       | -       | `"false"` | -                                                                                                                                                                            | -         |
| `cachingAtDepth`        | `caching_at_depth`        | integer | no       | -       | `5`       | -                                                                                                                                                                            | -         |
| `defaultForAgents`      | `default_for_agents`      | text    | no       | -       | `"false"` | -                                                                                                                                                                            | -         |
| `embeddingModel`        | `embedding_model`         | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `embeddingBaseUrl`      | `embedding_base_url`      | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `embeddingConnectionId` | `embedding_connection_id` | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `openrouterProvider`    | `openrouter_provider`     | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `imageGenerationSource` | `image_generation_source` | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `comfyuiWorkflow`       | `comfyui_workflow`        | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `imageService`          | `image_service`           | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `imageEndpointId`       | `image_endpoint_id`       | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `defaultParameters`     | `default_parameters`      | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `promptPresetId`        | `prompt_preset_id`        | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `maxTokensOverride`     | `max_tokens_override`     | integer | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `maxParallelJobs`       | `max_parallel_jobs`       | integer | no       | -       | `1`       | -                                                                                                                                                                            | -         |
| `claudeFastMode`        | `claude_fast_mode`        | text    | no       | -       | `"false"` | -                                                                                                                                                                            | -         |
| `folderId`              | `folder_id`               | text    | yes      | -       | -         | -                                                                                                                                                                            | -         |
| `sortOrder`             | `sort_order`              | integer | no       | -       | `0`       | -                                                                                                                                                                            | -         |
| `createdAt`             | `created_at`              | text    | no       | -       | -         | -                                                                                                                                                                            | -         |
| `updatedAt`             | `updated_at`              | text    | no       | -       | -         | -                                                                                                                                                                            | -         |

### assets

Source: `<legacy-root>/packages/server/src/db/schema/assets.ts`

| Key           | DB column      | Type | Nullable | Primary | Default | Enum                   | Reference |
| ------------- | -------------- | ---- | -------- | ------- | ------- | ---------------------- | --------- |
| `id`          | `id`           | text | no       | yes     | -       | -                      | -         |
| `type`        | `type`         | text | no       | -       | -       | `background`, `sprite` | -         |
| `characterId` | `character_id` | text | yes      | -       | -       | -                      | -         |
| `expression`  | `expression`   | text | yes      | -       | -       | -                      | -         |
| `name`        | `name`         | text | no       | -       | -       | -                      | -         |
| `filePath`    | `file_path`    | text | no       | -       | -       | -                      | -         |
| `createdAt`   | `created_at`   | text | no       | -       | -       | -                      | -         |

### agent_configs

Source: `<legacy-root>/packages/server/src/db/schema/agents.ts`

| Key              | DB column         | Type | Nullable | Primary | Default  | Enum                                            | Reference |
| ---------------- | ----------------- | ---- | -------- | ------- | -------- | ----------------------------------------------- | --------- |
| `id`             | `id`              | text | no       | yes     | -        | -                                               | -         |
| `type`           | `type`            | text | no       | -       | -        | -                                               | -         |
| `name`           | `name`            | text | no       | -       | -        | -                                               | -         |
| `description`    | `description`     | text | no       | -       | `""`     | -                                               | -         |
| `phase`          | `phase`           | text | no       | -       | -        | `pre_generation`, `parallel`, `post_processing` | -         |
| `enabled`        | `enabled`         | text | no       | -       | `"true"` | -                                               | -         |
| `connectionId`   | `connection_id`   | text | yes      | -       | -        | -                                               | -         |
| `imagePath`      | `image_path`      | text | yes      | -       | -        | -                                               | -         |
| `promptTemplate` | `prompt_template` | text | no       | -       | `""`     | -                                               | -         |
| `settings`       | `settings`        | text | no       | -       | `"{}"`   | -                                               | -         |
| `createdAt`      | `created_at`      | text | no       | -       | -        | -                                               | -         |
| `updatedAt`      | `updated_at`      | text | no       | -       | -        | -                                               | -         |

### agent_runs

Source: `<legacy-root>/packages/server/src/db/schema/agents.ts`

| Key             | DB column         | Type    | Nullable | Primary | Default  | Enum | Reference          |
| --------------- | ----------------- | ------- | -------- | ------- | -------- | ---- | ------------------ |
| `id`            | `id`              | text    | no       | yes     | -        | -    | -                  |
| `agentConfigId` | `agent_config_id` | text    | no       | -       | -        | -    | `agent_configs.id` |
| `chatId`        | `chat_id`         | text    | no       | -       | -        | -    | -                  |
| `messageId`     | `message_id`      | text    | no       | -       | -        | -    | -                  |
| `resultType`    | `result_type`     | text    | no       | -       | -        | -    | -                  |
| `resultData`    | `result_data`     | text    | no       | -       | `"{}"`   | -    | -                  |
| `tokensUsed`    | `tokens_used`     | integer | no       | -       | `0`      | -    | -                  |
| `durationMs`    | `duration_ms`     | integer | no       | -       | `0`      | -    | -                  |
| `success`       | `success`         | text    | no       | -       | `"true"` | -    | -                  |
| `error`         | `error`           | text    | yes      | -       | -        | -    | -                  |
| `createdAt`     | `created_at`      | text    | no       | -       | -        | -    | -                  |

### agent_memory

Source: `<legacy-root>/packages/server/src/db/schema/agents.ts`

| Key             | DB column         | Type | Nullable | Primary | Default | Enum | Reference          |
| --------------- | ----------------- | ---- | -------- | ------- | ------- | ---- | ------------------ |
| `id`            | `id`              | text | no       | yes     | -       | -    | -                  |
| `agentConfigId` | `agent_config_id` | text | no       | -       | -       | -    | `agent_configs.id` |
| `chatId`        | `chat_id`         | text | no       | -       | -       | -    | -                  |
| `key`           | `key`             | text | no       | -       | -       | -    | -                  |
| `value`         | `value`           | text | no       | -       | `""`    | -    | -                  |
| `updatedAt`     | `updated_at`      | text | no       | -       | -       | -    | -                  |

### custom_tools

Source: `<legacy-root>/packages/server/src/db/schema/custom-tools.ts`

| Key                | DB column           | Type | Nullable | Primary | Default    | Enum | Reference |
| ------------------ | ------------------- | ---- | -------- | ------- | ---------- | ---- | --------- |
| `id`               | `id`                | text | no       | yes     | -          | -    | -         |
| `name`             | `name`              | text | no       | -       | -          | -    | -         |
| `description`      | `description`       | text | no       | -       | `""`       | -    | -         |
| `parametersSchema` | `parameters_schema` | text | no       | -       | `"{}"`     | -    | -         |
| `executionType`    | `execution_type`    | text | no       | -       | `"static"` | -    | -         |
| `webhookUrl`       | `webhook_url`       | text | yes      | -       | -          | -    | -         |
| `staticResult`     | `static_result`     | text | yes      | -       | -          | -    | -         |
| `scriptBody`       | `script_body`       | text | yes      | -       | -          | -    | -         |
| `enabled`          | `enabled`           | text | no       | -       | `"true"`   | -    | -         |
| `createdAt`        | `created_at`        | text | no       | -       | -          | -    | -         |
| `updatedAt`        | `updated_at`        | text | no       | -       | -          | -    | -         |

### game_state_snapshots

Source: `<legacy-root>/packages/server/src/db/schema/game-state.ts`

| Key                 | DB column            | Type    | Nullable | Primary | Default | Enum | Reference |
| ------------------- | -------------------- | ------- | -------- | ------- | ------- | ---- | --------- |
| `id`                | `id`                 | text    | no       | yes     | -       | -    | -         |
| `chatId`            | `chat_id`            | text    | no       | -       | -       | -    | -         |
| `messageId`         | `message_id`         | text    | no       | -       | -       | -    | -         |
| `swipeIndex`        | `swipe_index`        | integer | no       | -       | `0`     | -    | -         |
| `date`              | `date`               | text    | yes      | -       | -       | -    | -         |
| `time`              | `time`               | text    | yes      | -       | -       | -    | -         |
| `location`          | `location`           | text    | yes      | -       | -       | -    | -         |
| `weather`           | `weather`            | text    | yes      | -       | -       | -    | -         |
| `temperature`       | `temperature`        | text    | yes      | -       | -       | -    | -         |
| `presentCharacters` | `present_characters` | text    | no       | -       | `"[]"`  | -    | -         |
| `recentEvents`      | `recent_events`      | text    | no       | -       | `"[]"`  | -    | -         |
| `playerStats`       | `player_stats`       | text    | yes      | -       | -       | -    | -         |
| `personaStats`      | `persona_stats`      | text    | yes      | -       | -       | -    | -         |
| `manualOverrides`   | `manual_overrides`   | text    | yes      | -       | -       | -    | -         |
| `fieldLocks`        | `field_locks`        | text    | yes      | -       | -       | -    | -         |
| `committed`         | `committed`          | integer | no       | -       | `0`     | -    | -         |
| `createdAt`         | `created_at`         | text    | no       | -       | -       | -    | -         |

### game_checkpoints

Source: `<legacy-root>/packages/server/src/db/schema/checkpoints.ts`

| Key           | DB column      | Type    | Nullable | Primary | Default | Enum                                                                                                       | Reference |
| ------------- | -------------- | ------- | -------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| `id`          | `id`           | text    | no       | yes     | -       | -                                                                                                          | -         |
| `chatId`      | `chat_id`      | text    | no       | -       | -       | -                                                                                                          | -         |
| `snapshotId`  | `snapshot_id`  | text    | no       | -       | -       | -                                                                                                          | -         |
| `messageId`   | `message_id`   | text    | no       | -       | -       | -                                                                                                          | -         |
| `label`       | `label`        | text    | no       | -       | -       | -                                                                                                          | -         |
| `triggerType` | `trigger_type` | text    | no       | -       | -       | `manual`, `session_start`, `session_end`, `combat_start`, `combat_end`, `location_change`, `auto_interval` | -         |
| `location`    | `location`     | text    | yes      | -       | -       | -                                                                                                          | -         |
| `gameState`   | `game_state`   | text    | yes      | -       | -       | -                                                                                                          | -         |
| `weather`     | `weather`      | text    | yes      | -       | -       | -                                                                                                          | -         |
| `timeOfDay`   | `time_of_day`  | text    | yes      | -       | -       | -                                                                                                          | -         |
| `turnNumber`  | `turn_number`  | integer | yes      | -       | -       | -                                                                                                          | -         |
| `createdAt`   | `created_at`   | text    | no       | -       | -       | -                                                                                                          | -         |

### regex_scripts

Source: `<legacy-root>/packages/server/src/db/schema/regex-scripts.ts`

| Key                  | DB column              | Type    | Nullable | Primary | Default           | Enum | Reference |
| -------------------- | ---------------------- | ------- | -------- | ------- | ----------------- | ---- | --------- |
| `id`                 | `id`                   | text    | no       | yes     | -                 | -    | -         |
| `name`               | `name`                 | text    | no       | -       | -                 | -    | -         |
| `enabled`            | `enabled`              | text    | no       | -       | `"true"`          | -    | -         |
| `findRegex`          | `find_regex`           | text    | no       | -       | -                 | -    | -         |
| `replaceString`      | `replace_string`       | text    | no       | -       | `""`              | -    | -         |
| `trimStrings`        | `trim_strings`         | text    | no       | -       | `"[]"`            | -    | -         |
| `placement`          | `placement`            | text    | no       | -       | `'["ai_output"]'` | -    | -         |
| `flags`              | `flags`                | text    | no       | -       | `"gi"`            | -    | -         |
| `promptOnly`         | `prompt_only`          | text    | no       | -       | `"false"`         | -    | -         |
| `targetCharacterIds` | `target_character_ids` | text    | no       | -       | `"[]"`            | -    | -         |
| `order`              | `order`                | integer | no       | -       | `0`               | -    | -         |
| `minDepth`           | `min_depth`            | integer | yes      | -       | -                 | -    | -         |
| `maxDepth`           | `max_depth`            | integer | yes      | -       | -                 | -    | -         |
| `createdAt`          | `created_at`           | text    | no       | -       | -                 | -    | -         |
| `updatedAt`          | `updated_at`           | text    | no       | -       | -                 | -    | -         |

### chat_images

Source: `<legacy-root>/packages/server/src/db/schema/gallery.ts`

| Key         | DB column    | Type    | Nullable | Primary | Default | Enum | Reference                    |
| ----------- | ------------ | ------- | -------- | ------- | ------- | ---- | ---------------------------- |
| `id`        | `id`         | text    | no       | yes     | -       | -    | -                            |
| `chatId`    | `chat_id`    | text    | no       | -       | -       | -    | `chats.id` on delete cascade |
| `filePath`  | `file_path`  | text    | no       | -       | -       | -    | -                            |
| `prompt`    | `prompt`     | text    | no       | -       | `""`    | -    | -                            |
| `provider`  | `provider`   | text    | no       | -       | `""`    | -    | -                            |
| `model`     | `model`      | text    | no       | -       | `""`    | -    | -                            |
| `width`     | `width`      | integer | yes      | -       | -       | -    | -                            |
| `height`    | `height`     | integer | yes      | -       | -       | -    | -                            |
| `createdAt` | `created_at` | text    | no       | -       | -       | -    | -                            |

### character_images

Source: `<legacy-root>/packages/server/src/db/schema/gallery.ts`

| Key           | DB column      | Type    | Nullable | Primary | Default | Enum | Reference                         |
| ------------- | -------------- | ------- | -------- | ------- | ------- | ---- | --------------------------------- |
| `id`          | `id`           | text    | no       | yes     | -       | -    | -                                 |
| `characterId` | `character_id` | text    | no       | -       | -       | -    | `characters.id` on delete cascade |
| `filePath`    | `file_path`    | text    | no       | -       | -       | -    | -                                 |
| `prompt`      | `prompt`       | text    | no       | -       | `""`    | -    | -                                 |
| `provider`    | `provider`     | text    | no       | -       | `""`    | -    | -                                 |
| `model`       | `model`        | text    | no       | -       | `""`    | -    | -                                 |
| `width`       | `width`        | integer | yes      | -       | -       | -    | -                                 |
| `height`      | `height`       | integer | yes      | -       | -       | -    | -                                 |
| `createdAt`   | `created_at`   | text    | no       | -       | -       | -    | -                                 |

### ooc_influences

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key               | DB column           | Type | Nullable | Primary | Default   | Enum | Reference                    |
| ----------------- | ------------------- | ---- | -------- | ------- | --------- | ---- | ---------------------------- |
| `id`              | `id`                | text | no       | yes     | -         | -    | -                            |
| `sourceChatId`    | `source_chat_id`    | text | no       | -       | -         | -    | `chats.id` on delete cascade |
| `targetChatId`    | `target_chat_id`    | text | no       | -       | -         | -    | `chats.id` on delete cascade |
| `content`         | `content`           | text | no       | -       | -         | -    | -                            |
| `anchorMessageId` | `anchor_message_id` | text | yes      | -       | -         | -    | -                            |
| `consumed`        | `consumed`          | text | no       | -       | `"false"` | -    | -                            |
| `createdAt`       | `created_at`        | text | no       | -       | -         | -    | -                            |

### conversation_notes

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key               | DB column           | Type | Nullable | Primary | Default | Enum | Reference                    |
| ----------------- | ------------------- | ---- | -------- | ------- | ------- | ---- | ---------------------------- |
| `id`              | `id`                | text | no       | yes     | -       | -    | -                            |
| `sourceChatId`    | `source_chat_id`    | text | no       | -       | -       | -    | `chats.id` on delete cascade |
| `targetChatId`    | `target_chat_id`    | text | no       | -       | -       | -    | `chats.id` on delete cascade |
| `content`         | `content`           | text | no       | -       | -       | -    | -                            |
| `anchorMessageId` | `anchor_message_id` | text | yes      | -       | -       | -    | -                            |
| `createdAt`       | `created_at`        | text | no       | -       | -       | -    | -                            |

### memory_chunks

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key              | DB column          | Type    | Nullable | Primary | Default | Enum | Reference                    |
| ---------------- | ------------------ | ------- | -------- | ------- | ------- | ---- | ---------------------------- |
| `id`             | `id`               | text    | no       | yes     | -       | -    | -                            |
| `chatId`         | `chat_id`          | text    | no       | -       | -       | -    | `chats.id` on delete cascade |
| `content`        | `content`          | text    | no       | -       | -       | -    | -                            |
| `embedding`      | `embedding`        | text    | yes      | -       | -       | -    | -                            |
| `messageCount`   | `message_count`    | integer | no       | -       | -       | -    | -                            |
| `sourceChatId`   | `source_chat_id`   | text    | yes      | -       | -       | -    | -                            |
| `firstMessageAt` | `first_message_at` | text    | no       | -       | -       | -    | -                            |
| `lastMessageAt`  | `last_message_at`  | text    | no       | -       | -       | -    | -                            |
| `createdAt`      | `created_at`       | text    | no       | -       | -       | -    | -                            |

### chat_folders

Source: `<legacy-root>/packages/server/src/db/schema/chats.ts`

| Key         | DB column    | Type    | Nullable | Primary | Default   | Enum                                               | Reference |
| ----------- | ------------ | ------- | -------- | ------- | --------- | -------------------------------------------------- | --------- |
| `id`        | `id`         | text    | no       | yes     | -         | -                                                  | -         |
| `name`      | `name`       | text    | no       | -       | -         | -                                                  | -         |
| `mode`      | `mode`       | text    | no       | -       | -         | `conversation`, `roleplay`, `visual_novel`, `game` | -         |
| `color`     | `color`      | text    | no       | -       | `""`      | -                                                  | -         |
| `sortOrder` | `sort_order` | integer | no       | -       | `0`       | -                                                  | -         |
| `collapsed` | `collapsed`  | text    | no       | -       | `"false"` | -                                                  | -         |
| `createdAt` | `created_at` | text    | no       | -       | -         | -                                                  | -         |
| `updatedAt` | `updated_at` | text    | no       | -       | -         | -                                                  | -         |

### api_connection_folders

Source: `<legacy-root>/packages/server/src/db/schema/connection-folders.ts`

| Key         | DB column    | Type    | Nullable | Primary | Default   | Enum | Reference |
| ----------- | ------------ | ------- | -------- | ------- | --------- | ---- | --------- |
| `id`        | `id`         | text    | no       | yes     | -         | -    | -         |
| `name`      | `name`       | text    | no       | -       | -         | -    | -         |
| `color`     | `color`      | text    | no       | -       | `""`      | -    | -         |
| `sortOrder` | `sort_order` | integer | no       | -       | `0`       | -    | -         |
| `collapsed` | `collapsed`  | text    | no       | -       | `"false"` | -    | -         |
| `createdAt` | `created_at` | text    | no       | -       | -         | -    | -         |
| `updatedAt` | `updated_at` | text    | no       | -       | -         | -    | -         |

### custom_themes

Source: `<legacy-root>/packages/server/src/db/schema/themes.ts`

| Key           | DB column      | Type | Nullable | Primary | Default   | Enum | Reference |
| ------------- | -------------- | ---- | -------- | ------- | --------- | ---- | --------- |
| `id`          | `id`           | text | no       | yes     | -         | -    | -         |
| `name`        | `name`         | text | no       | -       | -         | -    | -         |
| `css`         | `css`          | text | no       | -       | `""`      | -    | -         |
| `installedAt` | `installed_at` | text | no       | -       | -         | -    | -         |
| `createdAt`   | `created_at`   | text | no       | -       | -         | -    | -         |
| `updatedAt`   | `updated_at`   | text | no       | -       | -         | -    | -         |
| `isActive`    | `is_active`    | text | no       | -       | `"false"` | -    | -         |

### app_settings

Source: `<legacy-root>/packages/server/src/db/schema/app-settings.ts`

| Key         | DB column    | Type | Nullable | Primary | Default | Enum | Reference |
| ----------- | ------------ | ---- | -------- | ------- | ------- | ---- | --------- |
| `key`       | `key`        | text | no       | yes     | -       | -    | -         |
| `value`     | `value`      | text | no       | -       | `""`    | -    | -         |
| `updatedAt` | `updated_at` | text | no       | -       | -       | -    | -         |

### chat_presets

Source: `<legacy-root>/packages/server/src/db/schema/chat-presets.ts`

| Key         | DB column    | Type | Nullable | Primary | Default   | Enum                                               | Reference |
| ----------- | ------------ | ---- | -------- | ------- | --------- | -------------------------------------------------- | --------- |
| `id`        | `id`         | text | no       | yes     | -         | -                                                  | -         |
| `name`      | `name`       | text | no       | -       | -         | -                                                  | -         |
| `mode`      | `mode`       | text | no       | -       | -         | `conversation`, `roleplay`, `visual_novel`, `game` | -         |
| `isDefault` | `is_default` | text | no       | -       | `"false"` | -                                                  | -         |
| `isActive`  | `is_active`  | text | no       | -       | `"false"` | -                                                  | -         |
| `settings`  | `settings`   | text | no       | -       | `"{}"`    | -                                                  | -         |
| `createdAt` | `created_at` | text | no       | -       | -         | -                                                  | -         |
| `updatedAt` | `updated_at` | text | no       | -       | -         | -                                                  | -         |

### prompt_overrides

Source: `<legacy-root>/packages/server/src/db/schema/prompt-overrides.ts`

| Key         | DB column    | Type    | Nullable | Primary | Default | Enum | Reference |
| ----------- | ------------ | ------- | -------- | ------- | ------- | ---- | --------- |
| `key`       | `key`        | text    | no       | yes     | -       | -    | -         |
| `template`  | `template`   | text    | no       | -       | -       | -    | -         |
| `enabled`   | `enabled`    | integer | no       | -       | `1`     | -    | -         |
| `updatedAt` | `updated_at` | text    | no       | -       | -       | -    | -         |

### installed_extensions

Source: `<legacy-root>/packages/server/src/db/schema/extensions.ts`

| Key           | DB column      | Type | Nullable | Primary | Default  | Enum | Reference |
| ------------- | -------------- | ---- | -------- | ------- | -------- | ---- | --------- |
| `id`          | `id`           | text | no       | yes     | -        | -    | -         |
| `name`        | `name`         | text | no       | -       | -        | -    | -         |
| `description` | `description`  | text | no       | -       | `""`     | -    | -         |
| `css`         | `css`          | text | yes      | -       | -        | -    | -         |
| `js`          | `js`           | text | yes      | -       | -        | -    | -         |
| `enabled`     | `enabled`      | text | no       | -       | `"true"` | -    | -         |
| `installedAt` | `installed_at` | text | no       | -       | -        | -    | -         |
| `createdAt`   | `created_at`   | text | no       | -       | -        | -    | -         |
| `updatedAt`   | `updated_at`   | text | no       | -       | -        | -    | -         |
