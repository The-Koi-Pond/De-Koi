import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import prettier from "prettier";

const defaultLegacyRoot = "C:\\MarinaraEngine";
const targetPath = "docs/legacy-database-schema.md";

function parseArgs(argv) {
  const args = {
    checkOnly: false,
    skipMissing: false,
    legacyRoot: process.env.MARINARA_ENGINE_ROOT ?? defaultLegacyRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      args.checkOnly = true;
    } else if (arg === "--skip-missing") {
      args.skipMissing = true;
    } else if (arg === "--legacy-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--legacy-root requires a path.");
      args.legacyRoot = value;
      index += 1;
    } else if (arg.startsWith("--legacy-root=")) {
      args.legacyRoot = arg.slice("--legacy-root=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

const tableMetadata = {
  chats: {
    deKoi: "`chats`",
    notes: "Legacy stores `visual_novel` as a mode enum; De-Koi accepts it as an import/runtime alias for roleplay.",
  },
  messages: {
    deKoi: "`messages`",
    notes:
      "Legacy stores `extra` as JSON text; De-Koi keeps message extras as JSON objects and materializes swipe sidecars.",
  },
  message_swipes: {
    deKoi: "`message-swipes`",
    notes: "Legacy has no denormalized `chatId`; De-Koi sidecars include it.",
  },
  characters: {
    deKoi: "`characters`",
    notes: "CharacterData V2 JSON is the durable payload in both systems.",
  },
  character_card_versions: {
    deKoi: "`character-versions`",
    notes: "Character snapshot history.",
  },
  personas: {
    deKoi: "`personas`",
    notes: "Persona fields are mostly first-class columns in legacy and object fields in De-Koi.",
  },
  character_groups: {
    deKoi: "`character-groups`",
    notes: "Stores character IDs as a JSON array.",
  },
  persona_groups: {
    deKoi: "`persona-groups`",
    notes: "Stores persona IDs as a JSON array.",
  },
  lorebooks: {
    deKoi: "`lorebooks`",
    notes: "Legacy also has link tables for character/persona scope.",
  },
  lorebook_character_links: {
    deKoi: "`lorebooks` scope data",
    notes: "Legacy join table; De-Koi import/profile flows collapse scope into lorebook-compatible JSON fields.",
  },
  lorebook_persona_links: {
    deKoi: "`lorebooks` scope data",
    notes: "Legacy join table; De-Koi import/profile flows collapse scope into lorebook-compatible JSON fields.",
  },
  lorebook_folders: {
    deKoi: "`lorebook-folders`",
    notes: "Folder rows remain a separate collection.",
  },
  lorebook_entries: {
    deKoi: "`lorebook-entries`",
    notes: "Entry fields are close to De-Koi, with JSON text columns normalized on import.",
  },
  prompt_presets: {
    deKoi: "`prompts`",
    notes: "Legacy table name differs from De-Koi's collection name.",
  },
  prompt_groups: {
    deKoi: "`prompt-groups`",
    notes: "Prompt preset child table.",
  },
  prompt_sections: {
    deKoi: "`prompt-sections`",
    notes: "Contains legacy wrapping columns that De-Koi preserves as compatibility data where relevant.",
  },
  choice_blocks: {
    deKoi: "`prompt-variables`",
    notes: "Legacy choice blocks become prompt variables in De-Koi.",
  },
  api_connections: {
    deKoi: "`connections`",
    notes: "Secrets and provider-specific fields need special handling during profile import/export.",
  },
  api_connection_folders: {
    deKoi: "`connection-folders`",
    notes: "Folder rows remain a separate collection.",
  },
  assets: {
    deKoi: "`background-metadata`, `sprites`, managed files",
    notes: "Legacy combines background and sprite asset metadata in one table.",
  },
  agent_configs: {
    deKoi: "`agents`",
    notes: "Legacy custom script-tool affordances are intentionally unsupported in De-Koi execution.",
  },
  agent_runs: {
    deKoi: "`agent-runs`",
    notes: "Legacy snake_case row shape is accepted by De-Koi repair/import paths.",
  },
  agent_memory: {
    deKoi: "`agent-memory`",
    notes: "Per-agent, per-chat key/value state.",
  },
  custom_tools: {
    deKoi: "`custom-tools`",
    notes: "Legacy script tools are preserved for review but cannot execute in De-Koi.",
  },
  game_state_snapshots: {
    deKoi: "`game-state-snapshots`",
    notes: "Per-message/swipe tracker state.",
  },
  game_checkpoints: {
    deKoi: "`game-checkpoints`",
    notes: "Game rollback/checkpoint rows.",
  },
  regex_scripts: {
    deKoi: "`regex-scripts`",
    notes: "Find/replace script rows.",
  },
  chat_images: {
    deKoi: "`gallery`",
    notes: "Legacy chat images map to De-Koi shared/chat gallery rows and managed gallery files.",
  },
  character_images: {
    deKoi: "`character-gallery`",
    notes: "Legacy character images map to character gallery rows and managed gallery files.",
  },
  ooc_influences: {
    deKoi: "`chats.notes[]`",
    notes: "Imported as embedded one-shot influence notes on the target chat.",
  },
  conversation_notes: {
    deKoi: "`chats.notes[]`",
    notes: "Imported as embedded durable conversation notes on the target chat.",
  },
  memory_chunks: {
    deKoi: "`chats.memories[]`",
    notes: "Imported as embedded memory chunks; De-Koi has no standalone `chat-memory` collection.",
  },
  chat_folders: {
    deKoi: "`chat-folders`",
    notes: "Folder rows remain a separate collection.",
  },
  custom_themes: {
    deKoi: "`themes`",
    notes: "Legacy table name differs from De-Koi's collection name.",
  },
  app_settings: {
    deKoi: "`app-settings`",
    notes: "Loose settings key/value payload.",
  },
  chat_presets: {
    deKoi: "`chat-presets`",
    notes: "Reusable mode/generation defaults.",
  },
  prompt_overrides: {
    deKoi: "`prompt-overrides`",
    notes: "Compatibility rows for prompt-section override behavior.",
  },
  installed_extensions: {
    deKoi: "`extensions`",
    notes: "Imported extension rows are disabled by De-Koi profile import.",
  },
};

const deKoiOnlyRows = [
  ["`persona-gallery`", "De-Koi adds a persona-owned gallery split from legacy's chat/character image tables."],
  ["`global-gallery`", "De-Koi adds a global gallery split from legacy's chat/character image tables."],
  ["`gallery-folders`", "De-Koi adds gallery folders; legacy image tables have no folder table."],
  ["`plugin-memory`", "De-Koi adds namespaced plugin key/value storage."],
  ["`knowledge-sources`", "De-Koi tracks knowledge-source metadata outside the legacy Drizzle tables."],
  ["`background-metadata`", "De-Koi splits background metadata from legacy's mixed `assets` table."],
  ["`sprites`", "De-Koi keeps sprite compatibility metadata separate from legacy's mixed `assets` table."],
];

function findMatching(source, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\" && quote !== "`") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Could not find matching ${closeChar}.`);
}

function splitTopLevel(input) {
  const parts = [];
  let start = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\" && quote !== "`") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }

  const tail = input.slice(start);
  if (tail.trim()) parts.push(tail);
  return parts;
}

function stripComments(input) {
  return input.replace(/\/\*\*?[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function extractComments(input) {
  const comments = [];
  for (const match of input.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
    const text = match[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
    if (text) comments.push(text);
  }
  return comments;
}

function extractCallArgument(expression, callName) {
  const marker = `.${callName}(`;
  const markerIndex = expression.indexOf(marker);
  if (markerIndex === -1) return null;
  const openIndex = markerIndex + marker.length - 1;
  const closeIndex = findMatching(expression, openIndex, "(", ")");
  return expression.slice(openIndex + 1, closeIndex).trim();
}

function inlineCode(value) {
  if (!value) return "-";
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function markdownText(value) {
  return String(value).replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function parseColumn(entry, tableNameMap) {
  const comments = extractComments(entry);
  const normalized = stripComments(entry).trim();
  const property = normalized.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
  if (!property) return null;

  const [, key, expression] = property;
  const typeMatch = expression.match(/\b(text|integer|real|blob|numeric)\(\s*"([^"]+)"/);
  if (!typeMatch) return null;

  const enumMatch = expression.match(/enum:\s*\[([\s\S]*?)\]/);
  const enumValues = enumMatch ? [...enumMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];
  const defaultArgument = extractCallArgument(expression, "default");
  const referenceMatch = expression.match(
    /\.references\(\s*\(\)\s*=>\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/,
  );
  const reference = referenceMatch
    ? {
        table: tableNameMap.get(referenceMatch[1]) ?? referenceMatch[1],
        columnKey: referenceMatch[2],
        onDelete: referenceMatch[3]?.match(/onDelete:\s*"([^"]+)"/)?.[1] ?? "",
      }
    : null;

  return {
    key,
    dbName: typeMatch[2],
    type: typeMatch[1],
    primary: expression.includes(".primaryKey()"),
    notNull: expression.includes(".notNull()") || expression.includes(".primaryKey()"),
    defaultValue: defaultArgument,
    enumValues,
    reference,
    notes: comments,
  };
}

function parseTablesFromSource(source, file, tableNameMap) {
  const tables = [];
  const tableRegex = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*sqliteTable\(\s*"([^"]+)"\s*,\s*\{/g;

  for (const match of source.matchAll(tableRegex)) {
    const [, exportName, name] = match;
    const columnsStart = source.indexOf("{", match.index);
    const columnsEnd = findMatching(source, columnsStart, "{", "}");
    const columnsBody = source.slice(columnsStart + 1, columnsEnd);
    const columns = splitTopLevel(columnsBody)
      .map((entry) => parseColumn(entry, tableNameMap))
      .filter(Boolean);
    const tableEnd = findMatching(source, source.indexOf("(", match.index), "(", ")");
    const tableBody = source.slice(columnsEnd + 1, tableEnd);
    const indexes = [...tableBody.matchAll(/uniqueIndex\("([^"]+)"\)\.on\(([\s\S]*?)\)/g)].map((indexMatch) => ({
      name: indexMatch[1],
      columns: [...indexMatch[2].matchAll(/table\.([A-Za-z_$][\w$]*)/g)].map((columnMatch) => columnMatch[1]),
    }));

    tables.push({
      exportName,
      name,
      file,
      columns,
      indexes,
      primaryKey: columns.find((column) => column.primary)?.key ?? "-",
    });
  }

  return tables;
}

function parseFileBackedTables(source) {
  const match = source.match(/export\s+const\s+FILE_BACKED_TABLES\s*=\s*\[([\s\S]*?)\]\s+as\s+const;/);
  if (!match) throw new Error("Could not find FILE_BACKED_TABLES in legacy file-backed-store.ts.");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function parseCascades(source) {
  const match = source.match(/const\s+CASCADES:[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error("Could not find CASCADES in legacy file-backed-store.ts.");
  return [
    ...match[1].matchAll(
      /\{\s*parent:\s*"([^"]+)",\s*child:\s*"([^"]+)",\s*parentKey:\s*"([^"]+)",\s*childKey:\s*"([^"]+)"\s*\}/g,
    ),
  ].map((entry) => ({
    parent: entry[1],
    child: entry[2],
    parentKey: entry[3],
    childKey: entry[4],
  }));
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownText).join(" | ")} |`),
  ].join("\n");
}

function renderDefault(defaultValue) {
  if (defaultValue === null || defaultValue === undefined || defaultValue === "") return "-";
  return inlineCode(defaultValue);
}

function renderReference(reference) {
  if (!reference) return "-";
  const suffix = reference.onDelete ? ` on delete ${reference.onDelete}` : "";
  return `${inlineCode(`${reference.table}.${reference.columnKey}`)}${suffix}`;
}

function columnRows(tableInfo) {
  return tableInfo.columns.map((column) => [
    inlineCode(column.key),
    inlineCode(column.dbName),
    column.type,
    column.notNull ? "no" : "yes",
    column.primary ? "yes" : "-",
    renderDefault(column.defaultValue),
    column.enumValues.length ? column.enumValues.map(inlineCode).join(", ") : "-",
    renderReference(column.reference),
  ]);
}

function render(tables, fileBackedTables, cascades) {
  const fileBackedSet = new Set(fileBackedTables);
  const fileBackedOrder = new Map(fileBackedTables.map((name, index) => [name, index]));
  const orderedTables = [...tables].sort((left, right) => {
    const leftOrder = fileBackedOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = fileBackedOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });
  const missingFromSchema = fileBackedTables.filter((name) => !tables.some((entry) => entry.name === name));
  if (missingFromSchema.length > 0) {
    throw new Error(`Legacy file-backed table has no parsed Drizzle schema: ${missingFromSchema.join(", ")}`);
  }

  const catalogRows = orderedTables.map((tableInfo) => {
    const metadata = tableMetadata[tableInfo.name];
    return [
      inlineCode(tableInfo.name),
      inlineCode(tableInfo.exportName),
      fileBackedSet.has(tableInfo.name) ? "yes" : "SQLite schema only",
      tableInfo.columns.length,
      inlineCode(tableInfo.primaryKey),
      metadata?.deKoi ?? "-",
      metadata?.notes ?? "-",
    ];
  });
  const cascadeRows = cascades.map((cascade) => [
    inlineCode(cascade.parent),
    inlineCode(cascade.child),
    inlineCode(`${cascade.parentKey} -> ${cascade.childKey}`),
  ]);
  const uniqueRows = orderedTables.flatMap((tableInfo) =>
    tableInfo.indexes.map((index) => [
      inlineCode(tableInfo.name),
      inlineCode(index.name),
      index.columns.map(inlineCode).join(", "),
    ]),
  );
  const columnSections = orderedTables
    .map(
      (tableInfo) => `### ${tableInfo.name}

Source: \`<legacy-root>/packages/server/src/db/schema/${basename(tableInfo.file)}\`

${table(["Key", "DB column", "Type", "Nullable", "Primary", "Default", "Enum", "Reference"], columnRows(tableInfo))}
`,
    )
    .join("\n");

  return `# Legacy Marinara Storage Schema

This document describes the legacy Marinara Engine persisted data model from the local legacy checkout. It is generated from Drizzle SQLite table declarations plus the file-native storage table list.

Refresh this file with:

\`\`\`sh
pnpm docs:schema:legacy
\`\`\`

By default the script reads \`C:\\MarinaraEngine\`. Use \`MARINARA_ENGINE_ROOT\` or \`--legacy-root <path>\` for another checkout.

## Source Of Truth

${table(
  ["Area", "Source"],
  [
    ["Legacy schema declarations", "`<legacy-root>/packages/server/src/db/schema/*.ts`"],
    ["File-native table list", "`<legacy-root>/packages/server/src/db/file-backed-store.ts`"],
    ["Runtime storage config", "`<legacy-root>/packages/server/src/config/runtime-config.ts`"],
  ],
)}

## Storage Model

Legacy Marinara v1.5.7+ uses file-native storage by default. Tables are kept in memory and persisted as JSON snapshots under:

\`\`\`text
DATA_DIR/storage/tables/<table>.json
DATA_DIR/storage/manifest.json
\`\`\`

The Drizzle SQLite schema still defines the table and column contract. SQLite is kept as an opt-in compatibility backend and as the source format for one-time import from older \`marinara-engine.db\` files.

## Table Catalog

${table(["Table", "Drizzle export", "File-backed", "Columns", "Primary key", "De-Koi target", "Comparison notes"], catalogRows)}

## File-Native Delete Cascades

The file-backed store emulates important SQLite cascades in source code.

${table(["Parent table", "Child table", "Key mapping"], cascadeRows)}

## Unique Indexes

${uniqueRows.length ? table(["Table", "Index", "Columns"], uniqueRows) : "No unique indexes were parsed from the current schema files."}

## De-Koi-Only Comparison Rows

These De-Koi collections do not have a direct legacy table equivalent in the parsed schema.

${table(["De-Koi collection", "Why it matters"], deKoiOnlyRows)}

## Column Catalog

${columnSections}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.legacyRoot)) {
    const message = `Legacy source root not found: ${args.legacyRoot}`;
    if (args.skipMissing) {
      console.warn(`${message}; skipping legacy schema generation.`);
      return;
    }
    throw new Error(`${message}. Set MARINARA_ENGINE_ROOT or pass --legacy-root.`);
  }

  const schemaDir = join(args.legacyRoot, "packages", "server", "src", "db", "schema");
  const fileBackedStorePath = join(args.legacyRoot, "packages", "server", "src", "db", "file-backed-store.ts");
  const schemaFiles = (await readdir(schemaDir))
    .filter((entry) => entry.endsWith(".ts") && entry !== "index.ts")
    .map((entry) => join(schemaDir, entry))
    .sort();
  const sources = await Promise.all(schemaFiles.map(async (file) => ({ file, source: await readFile(file, "utf8") })));
  const tableNameMap = new Map();
  for (const { source } of sources) {
    for (const match of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*sqliteTable\(\s*"([^"]+)"/g)) {
      tableNameMap.set(match[1], match[2]);
    }
  }

  const tables = sources.flatMap(({ file, source }) => parseTablesFromSource(source, file, tableNameMap));
  const fileBackedStoreSource = await readFile(fileBackedStorePath, "utf8");
  const fileBackedTables = parseFileBackedTables(fileBackedStoreSource);
  const cascades = parseCascades(fileBackedStoreSource);
  const raw = render(tables, fileBackedTables, cascades);
  const formatted = await prettier.format(raw, { filepath: targetPath, parser: "markdown" });

  if (args.checkOnly) {
    const current = await readFile(targetPath, "utf8");
    if (current !== formatted) {
      console.error(`${targetPath} is out of date. Run pnpm docs:schema:legacy.`);
      process.exit(1);
    }
    console.log(`${targetPath} is current.`);
  } else {
    await writeFile(targetPath, formatted);
    console.log(`Updated ${targetPath}.`);
  }
}

await main();
