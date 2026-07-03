import { readFile, writeFile } from "node:fs/promises";
import prettier from "prettier";

const contractsPath = "src-tauri/src/commands/storage/contracts.rs";
const targetPath = "docs/database-schema.md";
const checkOnly = process.argv.includes("--check");

const sourceRows = [
  ["Storage engine", "`src-tauri/crates/storage/src/lib.rs`"],
  ["Collection contract list", "`src-tauri/src/commands/storage/contracts.rs`"],
  ["Frontend storage gateway", "`src/engine/capabilities/storage.ts`"],
  ["Frontend collection manifest", "`src/engine/capabilities/storage-collections.ts`"],
  ["Frontend runtime wrapper", "`src/shared/api/storage-api.ts`"],
  ["Domain TypeScript types", "`src/engine/contracts/types/*`"],
  ["Runtime validation schemas", "`src/engine/contracts/schemas/*`"],
  ["Profile import/export", "`src-tauri/src/commands/storage/profile.rs`"],
  ["Legacy profile conversion", "`src-tauri/src/commands/storage/profile/legacy.rs`"],
];

const confidenceRows = [
  ["Schema-backed", "There is a nearby Zod schema in `src/engine/contracts/schemas`."],
  ["Type-backed", "There is a TypeScript interface/type in `src/engine/contracts/types`."],
  ["Rust-normalized", "Rust command code defines the durable row shape or compatibility repair."],
  ["Flexible JSON", "The collection intentionally stores loose plugin, settings, media, or runtime JSON."],
  ["Compatibility", "The collection exists mainly for import/export, migration, or legacy data."],
];

const collectionMetadata = {
  characters: {
    model: "`Character`",
    confidence: "Schema-backed",
    notes:
      "Referenced by `chats.characterIds`, `character-groups.characterIds`, lorebook scope fields, sprites, avatars, and character gallery rows.",
  },
  "character-groups": {
    model: "`CharacterGroup`",
    confidence: "Schema-backed",
    notes: "`characterIds[]` points to `characters.id`.",
  },
  "character-versions": {
    model: "`CharacterCardVersion`",
    confidence: "Type-backed",
    notes: "Snapshot history for character card data.",
  },
  personas: {
    model: "`Persona`",
    confidence: "Type-backed",
    notes:
      "Referenced by `chats.personaId`, `persona-groups.personaIds`, lorebook scope fields, sprites, avatars, and persona gallery rows.",
  },
  "persona-groups": {
    model: "`PersonaGroup`",
    confidence: "Schema-backed",
    notes: "`personaIds[]` points to `personas.id`.",
  },
  lorebooks: {
    model: "`Lorebook`",
    confidence: "Schema-backed",
    notes:
      "Parent rows for `lorebook-entries` and `lorebook-folders`; may scope to character, persona, chat, or global use. Optional `folderId` points to `lorebook-library-folders.id`.",
  },
  "lorebook-library-folders": {
    model: "`LibraryFolder`",
    confidence: "Schema-backed",
    notes: "Catalog organization folders for lorebook rows. Deleting a folder clears `lorebooks.folderId`.",
  },
  "lorebook-entries": {
    model: "`LorebookEntry`",
    confidence: "Schema-backed",
    notes: "`lorebookId` points to `lorebooks.id`; optional `folderId` points to `lorebook-folders.id`.",
  },
  "lorebook-folders": {
    model: "`LorebookFolder`",
    confidence: "Schema-backed",
    notes: "`lorebookId` points to `lorebooks.id`; `parentFolderId` nests within the same lorebook.",
  },
  prompts: {
    model: "`PromptPreset`",
    confidence: "Schema-backed",
    notes:
      "Parent rows for prompt groups, sections, variables, and overrides. Optional `folderId` points to `preset-folders.id`.",
  },
  "preset-folders": {
    model: "`LibraryFolder`",
    confidence: "Schema-backed",
    notes: "Catalog organization folders for prompt preset rows. Deleting a folder clears `prompts.folderId`.",
  },
  "prompt-groups": {
    model: "`PromptGroup`",
    confidence: "Schema-backed",
    notes: "`presetId` points to `prompts.id`; `parentGroupId` nests prompt groups.",
  },
  "prompt-sections": {
    model: "`PromptSection`",
    confidence: "Schema-backed",
    notes: "`presetId` points to `prompts.id`; optional `groupId` points to `prompt-groups.id`.",
  },
  "prompt-variables": {
    model: "`ChoiceBlock`",
    confidence: "Schema-backed",
    notes: "`presetId` points to `prompts.id`.",
  },
  "prompt-overrides": {
    model: "Prompt override row",
    confidence: "Rust-normalized",
    notes: "Prompt-section override data, including legacy/unsupported override filtering during profile import.",
  },
  "chat-presets": {
    model: "`ChatPreset`",
    confidence: "Schema-backed",
    notes: "Stores reusable mode and generation settings for new chats.",
  },
  agents: {
    model: "`AgentConfig`",
    confidence: "Schema-backed",
    notes: "Agent configuration rows. Built-in agents may be addressed by type as well as row id.",
  },
  "agent-runs": {
    model: "Agent run result row",
    confidence: "Rust-normalized",
    notes:
      "`chatId`, `messageId`, `agentConfigId`, `agentType`, `resultType`, `resultData`, success/error, token and duration fields. Legacy snake_case fields are still read.",
  },
  "agent-memory": {
    model: "Agent memory key/value row",
    confidence: "Rust-normalized",
    notes: "`agentConfigId`, `chatId`, `key`, and JSON-string `value`. Used for secret plot and other agent state.",
  },
  themes: {
    model: "`Theme`",
    confidence: "Schema-backed",
    notes: "Custom CSS themes; one row may be active.",
  },
  extensions: {
    model: "`InstalledExtension`",
    confidence: "Schema-backed",
    notes: "User-installed extension CSS/JS payloads; imported rows are disabled on profile import. Optional package metadata fields include `packageId`, `packageVersion`, `manifestVersion`, `compatibility`, `permissions`, `uiContributions`, and `source`.",
  },
  "plugin-memory": {
    model: "`PluginMemoryRecord`",
    confidence: "Type-backed",
    notes: "Namespaced plugin KV storage with `pluginId`, `key`, arbitrary `value`, and `schemaVersion`.",
  },
  "canonical-memories": {
    model: "`CanonicalMemoryRecord`",
    confidence: "Type-backed",
    notes:
      "Authoritative memory source of truth. Records have kind, status, scope, confidence, provenance, content, tags, supersession links, and kind-specific payloads. Legacy `chats.memories[]` rows are not backfilled in Phase 2.",
  },
  "memory-index-rows": {
    model: "`MemoryIndexRow`",
    confidence: "Type-backed",
    notes:
      "Rebuildable retrieval projection keyed by `memoryId`. Rows store provider/model/dimensions/hash metadata plus vector or lexical payloads; canonical memory status and timestamps win over index hits.",
  },
  "music-dj-playlists": {
    model: "`MusicDjPlaylist`",
    confidence: "Type-backed",
    notes: "Character, chat, and global Music Player playlist memory. `tracks[]` stores accepted YouTube candidates and feedback-weighted playback history.",
  },
  connections: {
    model: "`APIConnection`",
    confidence: "Schema-backed",
    notes: "Provider/model connection rows. Secrets are handled specially for export/import.",
  },
  "connection-folders": {
    model: "`ConnectionFolder`",
    confidence: "Type-backed",
    notes: "`connections.folderId` points here.",
  },
  chats: {
    model: "`Chat`",
    confidence: "Schema-backed",
    notes:
      "Parent for messages, embedded memories, notes, chat metadata, game state, active agents, active tools, and selected resources.",
  },
  "chat-folders": {
    model: "`ChatFolder`",
    confidence: "Type-backed",
    notes: "`chats.folderId` points here.",
  },
  messages: {
    model: "`Message`",
    confidence: "Schema-backed",
    notes:
      "`chatId` points to `chats.id`; `characterId` may point to `characters.id`; current swipe fields are materialized from sidecars.",
  },
  "message-swipes": {
    model: "`MessageSwipe`",
    confidence: "Type-backed, internal",
    notes:
      "Sidecar rows for alternate message responses. `messageId` points to `messages.id`; `chatId` denormalizes the chat.",
  },
  "custom-tools": {
    model: "`CustomTool`",
    confidence: "Schema-backed",
    notes: "User-defined static or webhook tools available to agents and generation.",
  },
  "regex-scripts": {
    model: "`RegexScript`",
    confidence: "Schema-backed",
    notes: "Find/replace scripts scoped globally or by `characterId`.",
  },
  "app-settings": {
    model: "Settings row",
    confidence: "Schema-backed",
    notes: "Loose app settings payload; `app-settings.schema.ts` covers update/response shape.",
  },
  gallery: {
    model: "Gallery media row",
    confidence: "Flexible JSON",
    notes:
      "Shared message/attachment image gallery; row references managed `gallery` files with `filePath` and `filename`.",
  },
  "character-gallery": {
    model: "Character gallery media row",
    confidence: "Flexible JSON",
    notes: "`characterId` points to `characters.id`; row references managed `gallery` files.",
  },
  "persona-gallery": {
    model: "Persona gallery media row",
    confidence: "Flexible JSON",
    notes: "`personaId` points to `personas.id`; row references managed `gallery` files.",
  },
  "global-gallery": {
    model: "Global gallery media row",
    confidence: "Flexible JSON",
    notes: "Root/global image gallery; row references managed `gallery` files.",
  },
  "gallery-folders": {
    model: "Gallery folder row",
    confidence: "Flexible JSON",
    notes: "Gallery rows can carry `folderId`; deleting a folder unfiles child rows.",
  },
  "background-metadata": {
    model: "Background metadata row",
    confidence: "Rust-normalized",
    notes: "`filename` points to a managed background file. Rows store original name, tags, and source metadata.",
  },
  sprites: {
    model: "Sprite metadata row",
    confidence: "Compatibility",
    notes:
      "Current sprite images mostly live under `data/sprites/<owner>`. This collection remains for legacy/profile metadata and cleanup fallback.",
  },
  "knowledge-sources": {
    model: "Knowledge source metadata",
    confidence: "Compatibility, special",
    notes:
      "Contract-listed for profiles, but live runtime metadata is `data/knowledge-sources/meta.json` with files beside it.",
  },
  "game-state-snapshots": {
    model: "`GameState` tracker snapshot",
    confidence: "Type-backed",
    notes: "`chatId`, `messageId`, and `swipeIndex` identify committed tracker state for a message/swipe.",
  },
  "game-checkpoints": {
    model: "Game checkpoint row",
    confidence: "Rust-normalized",
    notes: "Stores nullable `snapshot` and `metadata` objects for game rollback/checkpoint behavior.",
  },
};

const embeddedRows = [
  [
    "`chats.memories[]`",
    "`ChatMemoryChunk`",
    "Memory Recall rows stored on the chat. Transcript-owned chunks have message IDs, content, embedding state, and optional vectors; Phase 1 also preserves imported/manual/`[memory:]` command rows that may lack message IDs or carry `sourceChatId`/`commandMemoryKey`. Refresh rebuilds transcript chunks without deleting those preserved rows. There is no `chat-memory` collection.",
  ],
  [
    "`chats.notes[]`",
    "`ConversationNote` and `OocInfluence` style rows",
    "Legacy `conversation_notes` and `ooc_influences` tables import here as note/influence rows.",
  ],
  [
    "`chats.metadata`",
    "`ChatMetadata`",
    "Large mode-specific bag for summaries, agents, lorebook runtime state, sprites, group chat state, game session state, Discord mirroring, and other chat options.",
  ],
  [
    "`chats.gameState`",
    "Current visible tracker state",
    "Mirrors the latest visible tracker snapshot for runtime display. Durable per-message tracker history is in `game-state-snapshots`.",
  ],
  [
    "`messages.extra`",
    "`MessageExtra`",
    "Generation info, reasoning/thinking, prompt snapshots, hidden flags, attachments, persona snapshots, sprite/CYOA outputs, and other display/runtime metadata.",
  ],
  [
    "`message-swipes.extra`",
    "`MessageSwipeExtra`",
    "Swipe-scoped subset of message extra data, including generated prompt snapshots and character-specific data.",
  ],
];

const cleanupDescriptions = {
  ActivateDefaultChatPreset: "Activate a default chat preset when needed.",
  ClearChatFolder: "Clear `chats.folderId` for rows in the deleted folder.",
  ClearConnectionFolder: "Clear `connections.folderId` for rows in the deleted folder.",
  ClearGalleryFolder: "Clear `folderId` on gallery rows in the deleted folder.",
  ClearLorebookLibraryFolder: "Clear `lorebooks.folderId` for rows in the deleted folder.",
  ClearLorebookReferences: "Clear references to the deleted lorebook.",
  ClearPresetFolder: "Clear `prompts.folderId` for rows in the deleted folder.",
  DeleteCharacterGallery: "Delete character gallery rows and files.",
  DeleteLorebookChildren: "Delete lorebook entries and folders.",
  DeleteMessageTrackerSnapshots: "Delete tracker snapshots for the message.",
  DeletePersonaGallery: "Delete persona gallery rows and files.",
  DeletePromptChildren: "Delete prompt groups, sections, and variables.",
  RemoveOwnedMedia: "Remove owned managed media when applicable.",
};

function parseConstArrays(source) {
  const arrays = new Map();
  for (const match of source.matchAll(/const\s+([A-Z0-9_]+):[^=]*=\s*&\[([\s\S]*?)\];/g)) {
    const [, name, body] = match;
    arrays.set(name, {
      strings: [...body.matchAll(/"([^"]+)"/g)].map((item) => item[1]),
      fields: [...body.matchAll(/(array|nullable_array|object|nullable_object|boolish)\("([^"]+)"\)/g)].map((item) => ({
        kind: item[1],
        name: item[2],
      })),
      cleanup: [...body.matchAll(/DeleteCleanup::([A-Za-z0-9_]+)/g)].map((item) => item[1]),
    });
  }
  return arrays;
}

function parseCollections(source, arrays) {
  const block = source.match(/pub\(crate\) const COLLECTIONS:[\s\S]*?\];/)?.[0];
  if (!block) {
    throw new Error(`Could not find COLLECTIONS in ${contractsPath}.`);
  }

  const collections = [];
  for (const match of block.matchAll(
    /contract\(\s*"([^"]+)",\s*(true|false),\s*(true|false),\s*([A-Z0-9_]+),\s*([A-Z0-9_]+),\s*([A-Z0-9_]+),\s*\)/g,
  )) {
    const [, name, profile, startupJsonRepair, defaultsName, typedFieldsName, cleanupName] = match;
    const metadata = collectionMetadata[name];
    if (!metadata) {
      throw new Error(`Missing generator metadata for collection: ${name}`);
    }
    collections.push({
      ...metadata,
      name,
      profile: profile === "true",
      startupJsonRepair: startupJsonRepair === "true",
      defaultedFields: arrays.get(defaultsName)?.strings ?? [],
      typedFields: arrays.get(typedFieldsName)?.fields ?? [],
      cleanup: arrays.get(cleanupName)?.cleanup ?? [],
    });
  }

  const missingFromContracts = Object.keys(collectionMetadata).filter(
    (name) => !collections.some((collection) => collection.name === name),
  );
  if (missingFromContracts.length > 0) {
    throw new Error(`Generator metadata is stale; unknown collection metadata: ${missingFromContracts.join(", ")}`);
  }
  return collections;
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function inlineList(items) {
  return items.length ? items.map((item) => `\`${item}\``).join(", ") : "-";
}

function typedFieldLabel(field) {
  const kind = field.kind.replaceAll("_", " ");
  return `\`${field.name}: ${kind}\``;
}

function render(collections) {
  const catalogRows = collections.map((collection) => [
    `\`${collection.name}\``,
    collection.model,
    collection.confidence,
    collection.notes,
  ]);
  const normalizationRows = collections
    .filter((collection) => collection.defaultedFields.length > 0 || collection.typedFields.length > 0)
    .map((collection) => [
      `\`${collection.name}\``,
      inlineList(collection.defaultedFields),
      collection.typedFields.length ? collection.typedFields.map(typedFieldLabel).join(", ") : "-",
    ]);
  const cleanupRows = collections
    .filter((collection) => collection.cleanup.length > 0)
    .map((collection) => [
      `\`${collection.name}\``,
      collection.cleanup.map((name) => cleanupDescriptions[name] ?? name).join(" "),
    ]);

  return `# De-Koi Storage Schema

This document describes De-Koi's current persisted data model. It is a source-backed storage catalog, not a SQL migration file. De-Koi currently stores records as local JSON collections plus managed asset files.

Refresh this file with:

\`\`\`sh
pnpm docs:schema
\`\`\`

For the legacy Marinara counterpart generated from \`C:\\MarinaraEngine\`, see \`docs/legacy-database-schema.md\`.

## Source Of Truth

${table(["Area", "Source"], sourceRows)}

## Storage Model

De-Koi uses \`FileStorage\`, a JSON collection store. Each normal collection lives at:

\`\`\`text
<app-data>/collections/<collection>.json
\`\`\`

Each collection file contains a JSON array of record objects. \`create\` adds an \`id\` if one is missing and fills \`createdAt\` and \`updatedAt\` when absent. \`update\`, \`patch\`, and related helpers stamp \`updatedAt\`. There is no relational database, foreign-key constraint layer, or SQL migration directory.

\`messages\` and \`chats\` have append/read optimizations because they can be large, but they are still JSON collection files. Several asset-heavy areas combine a JSON collection row with a managed file under an app-data subfolder.

## Confidence Labels

${table(["Label", "Meaning"], confidenceRows)}

## Global Rules

- All normal collection rows are JSON objects with \`id\`, \`createdAt\`, and \`updatedAt\` available after a storage \`create\`.
- Collection names are validated before file access.
- Relationships are conventional IDs stored in fields such as \`chatId\`, \`characterId\`, \`lorebookId\`, or \`folderId\`; cleanup is implemented by storage commands, not by database constraints.
- Generic frontend CRUD uses \`StorageEntity\` from \`src/engine/capabilities/storage.ts\`, derived from the checked manifest in \`src/engine/capabilities/storage-collections.ts\`.
- \`message-swipes\` is internal sidecar storage. It is in the Rust profile contract but explicitly marked internal-only in the frontend manifest and intentionally blocked from generic frontend mutation.
- \`pnpm check:storage-contracts\` fails when the Rust storage collection registry and TypeScript storage manifest drift.
- Profile export/import uses every \`contracts::profile_collections()\` entry. Modern profile imports skip absent collections so a partial package does not wipe unrelated local collections.

## Collection Catalog

${table(["Collection", "Record model", "Confidence", "Key relationships and notes"], catalogRows)}

## Important Embedded Models

Some persisted models are embedded inside collection rows instead of receiving a collection file.

${table(["Location", "Model", "Notes"], embeddedRows)}

## Rust Contract Normalization

\`contracts.rs\` defines default fields and type repair for rows written through storage commands or imported through profile flows. \`array\` and \`object\` repairs normalize JSON fields that may arrive as serialized strings from legacy data. \`boolish\` accepts boolean-like legacy values.

${table(["Collection", "Defaulted fields", "Typed JSON repair"], normalizationRows)}

## Delete Cleanup

Deletes may trigger collection-specific cleanup in Rust command code.

${table(["Trigger collection", "Cleanup behavior"], cleanupRows)}

## Profile And Legacy Notes

- Native profile v1 exports write \`data.collections\` with every profile collection plus profile assets.
- Native profile import requires array values for present collections and rejects malformed non-array values.
- If \`messages\` is present but \`message-swipes\` is absent, import explicitly clears \`message-swipes\` and reports zero imported sidecars.
- \`connections\` are exported through a secrets-aware path so API key handling is not equivalent to a plain collection dump.
- Legacy \`conversation_notes\` and \`ooc_influences\` do not survive as standalone collections; they import into \`chats.notes\`.
- Legacy \`visual_novel\` chat mode is normalized to the canonical roleplay mode at app/runtime boundaries.
- \`docs/profile-export-format-v2.md\` describes a future chunked profile package. It uses table-like names, but it does not change current storage behavior.
`;
}

const contractsSource = await readFile(contractsPath, "utf8");
const arrays = parseConstArrays(contractsSource);
const collections = parseCollections(contractsSource, arrays);
const raw = render(collections);
const formatted = await prettier.format(raw, { filepath: targetPath, parser: "markdown" });

if (checkOnly) {
  const current = await readFile(targetPath, "utf8");
  if (current !== formatted) {
    console.error(`${targetPath} is out of date. Run pnpm docs:schema.`);
    process.exit(1);
  }
  console.log(`${targetPath} is current.`);
} else {
  await writeFile(targetPath, formatted);
  console.log(`Updated ${targetPath}.`);
}
