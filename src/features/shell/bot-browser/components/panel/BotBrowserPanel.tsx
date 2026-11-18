import { Globe, MoreHorizontal, User } from "lucide-react";
import { useMemo, useState } from "react";

import { isRecord } from "../../../../../engine/shared/value-readers";
import { ContextMenu } from "../../../../../shared/components/ui/ContextMenu";
import { cn } from "../../../../../shared/lib/utils";
import { useUIStore } from "../../../../../shared/stores/ui.store";
import {
  CharacterAvatarImage,
  characterAvatarUrl,
  useCharacterSummaries,
  useStartChatFromCharacter,
  type CharacterSummary,
} from "../../../../catalog/characters/index";

interface ImportedRow {
  summary: CharacterSummary;
  name: string;
  extensions: Record<string, unknown>;
}

function characterData(summary: CharacterSummary): Record<string, unknown> | null {
  const data: unknown = summary.data;
  if (isRecord(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return isRecord(parsed) ? parsed : null;
    } catch {
      // A character whose data isn't JSON can't carry the Browser's marker, so it isn't listed.
      return null;
    }
  }
  return null;
}

/** Characters imported through the Browser: the ones whose card carries `extensions.botBrowserSource`. */
function importedRows(summaries: CharacterSummary[] | undefined): ImportedRow[] {
  const rows: ImportedRow[] = [];
  for (const summary of summaries ?? []) {
    const data = characterData(summary);
    const extensions = isRecord(data?.extensions) ? data.extensions : null;
    if (!extensions?.botBrowserSource) continue;
    rows.push({ summary, name: typeof data?.name === "string" && data.name ? data.name : "Unnamed", extensions });
  }
  return rows;
}

type QuickStartMenu = { x: number; y: number; row: ImportedRow };

/** The `bot-browser` right panel: a way into the Browser and the characters already imported from it. */
export function BotBrowserPanel() {
  const botBrowserOpen = useUIStore((s) => s.botBrowserOpen);
  const openBotBrowser = useUIStore((s) => s.openBotBrowser);
  const openCharacterDetail = useUIStore((s) => s.openCharacterDetail);
  const { data: summaries, isLoading } = useCharacterSummaries();
  const { startChatFromCharacter } = useStartChatFromCharacter();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<QuickStartMenu | null>(null);

  const rows = useMemo(() => importedRows(summaries), [summaries]);
  const query = search.trim().toLowerCase();
  const visibleRows = query ? rows.filter((row) => row.name.toLowerCase().includes(query)) : rows;

  const quickStart = (row: ImportedRow, mode: "roleplay" | "conversation") =>
    startChatFromCharacter({ characterId: row.summary.id, characterName: row.name, mode });

  return (
    <div className="flex min-h-full flex-col">
      <button
        type="button"
        aria-pressed={botBrowserOpen}
        onClick={openBotBrowser}
        className={cn(
          "flex h-10 shrink-0 items-center justify-center gap-2 border-b border-[var(--border)]/60 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
          botBrowserOpen && "bg-[var(--accent)] text-[var(--primary)]",
        )}
      >
        <Globe size="0.875rem" aria-hidden="true" />
        Browse online
      </button>

      <div className="border-b border-[var(--border)]/60 p-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search imported..."
          aria-label="Search imported characters"
          className="h-8 w-full rounded-md border border-[var(--input)] bg-[var(--secondary)] px-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>

      <div className="flex-1 p-1">
        {isLoading ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--muted-foreground)]">Loading...</p>
        ) : visibleRows.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--muted-foreground)]">
            {query && rows.length > 0 ? "No matches" : "No imported characters yet"}
          </p>
        ) : (
          <ul aria-label="Imported characters">
            {visibleRows.map((row) => {
              const summary = row.summary;
              return (
                <li
                  key={summary.id}
                  className="group flex items-center rounded-md hover:bg-[var(--accent)]"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, row });
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openCharacterDetail(summary.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    {characterAvatarUrl(summary) || summary.avatarFilePath || summary.avatarFilename ? (
                      <CharacterAvatarImage
                        src={characterAvatarUrl(summary)}
                        avatarFilePath={summary.avatarFilePath}
                        avatarFilename={summary.avatarFilename}
                        alt=""
                        crop={row.extensions.avatarCrop}
                        thumbnailSize={128}
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                        <User size="0.875rem" aria-hidden="true" />
                      </span>
                    )}
                    <span className="truncate text-sm text-[var(--foreground)]">{row.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`More for ${row.name}`}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ x: rect.left, y: rect.bottom, row });
                    }}
                    className="de-koi-icon-target mr-1 shrink-0 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <MoreHorizontal size="0.875rem" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Quick start roleplay", onSelect: () => quickStart(menu.row, "roleplay") },
            { label: "Quick start conversation", onSelect: () => quickStart(menu.row, "conversation") },
          ]}
        />
      )}
    </div>
  );
}
