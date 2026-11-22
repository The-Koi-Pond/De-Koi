import { BookOpen, Check, Loader2, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { cn } from "../../../../../shared/lib/utils";
import { FieldGroup, NOTE, SMALL_LABEL, ToggleIcon } from "./editor-parts";
import type { AgentEditorModel } from "./use-agent-editor";

const ACCEPTED_FILES = ".txt,.md,.csv,.json,.xml,.html,.htm,.log,.yaml,.yml,.tsv,.pdf";

/** Lists of lorebooks and files: capped at 12rem, then they scroll. */
const CAPPED_LIST = "max-h-48 space-y-1 overflow-y-auto rounded-xl p-2";

/** Adds `id` at the end of the list, or takes it out. */
function toggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "<n> lorebook(s), <n> file(s) selected", only the non-zero parts. */
function selectionSummary(lorebooks: number, files: number): string | null {
  const parts = [lorebooks > 0 && plural(lorebooks, "lorebook"), files > 0 && plural(files, "file")].filter(Boolean);
  return parts.length > 0 ? `${parts.join(", ")} selected` : null;
}

/**
 * How many of the router's selected entries have a non-blank description. A description that is set but
 * isn't a string throws here, as it did in the old editor (see the spec's "Recorded details").
 */
function CoverageBadge({ editor }: { editor: AgentEditorModel }) {
  const { entries, isLoading, isError } = editor.entries;
  if (editor.form.sourceLorebookIds.length === 0 || isLoading || isError || !entries) return null;
  const described = entries.filter((entry) => (entry.description as string | null | undefined)?.trim()).length;
  const total = entries.length;
  const share = total === 0 ? 0 : described / total;
  const dot =
    total === 0
      ? "bg-[var(--muted-foreground)] opacity-50"
      : share >= 0.75
        ? "bg-emerald-400"
        : share >= 0.25
          ? "bg-amber-400"
          : "bg-red-400";
  return (
    <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {total === 0 ? "No entries yet" : `${Math.round(share * 100)}% described (${described}/${total})`}
    </span>
  );
}

/** A 1rem square checkbox, with a check when selected. */
function SelectBox({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
        on ? "border-amber-400/60 bg-amber-500/20 text-amber-300" : className,
      )}
    >
      {on && <Check size="0.625rem" />}
    </span>
  );
}

export function KnowledgeSourcesGroup({ editor }: { editor: AgentEditorModel }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { form, edit } = editor;
  const router = editor.isType("knowledge-router");
  const retrieval = editor.isType("knowledge-retrieval");
  const lorebooks = editor.lorebooksQuery.data ?? [];
  const files = editor.knowledgeSources ?? [];
  const summary = selectionSummary(form.sourceLorebookIds.length, form.sourceFileIds.length);
  const chatActive = form.useChatActiveLorebooks;
  return (
    <FieldGroup
      icon={BookOpen}
      iconClassName="text-amber-400"
      label="Knowledge Sources"
      help={
        router
          ? "Use chat-active lorebooks by default, or select fixed lorebooks for this agent to route over. The router picks relevant entries by id and they're injected verbatim."
          : "Use chat-active lorebooks by default, select fixed lorebooks, and/or upload files for this agent to scan. Supported file types: .txt, .md, .csv, .json, .xml, .html, .pdf"
      }
    >
      <button
        type="button"
        aria-pressed={chatActive}
        aria-label={`Use this chat's active lorebooks: ${chatActive ? "on" : "off"}`}
        onClick={() => edit((current) => ({ useChatActiveLorebooks: !current.useChatActiveLorebooks }))}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
          chatActive
            ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
            : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
        )}
      >
        <ToggleIcon on={chatActive} size="1.25rem" onClassName="text-amber-400" />
        <span className="min-w-0">
          <span className="block text-xs font-medium">Use this chat&apos;s active lorebooks</span>
          <span className="block text-[0.625rem] opacity-80">
            When no fixed source is selected below, this agent scans the lorebooks attached to the current chat.
          </span>
        </span>
      </button>
      <div className="pt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className={cn(SMALL_LABEL, "mb-0")}>Lorebooks</span>
          {router && <CoverageBadge editor={editor} />}
        </div>
        {lorebooks.length === 0 ? (
          <p className={NOTE}>No lorebooks available.</p>
        ) : (
          <ul className={cn(CAPPED_LIST, "ring-1 ring-[var(--border)]")}>
            {lorebooks.map((lorebook) => {
              const on = form.sourceLorebookIds.includes(lorebook.id);
              return (
                <li key={lorebook.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      edit((current) => ({ sourceLorebookIds: toggled(current.sourceLorebookIds, lorebook.id) }))
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                      on
                        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                        : "border-transparent bg-[var(--secondary)] text-[var(--foreground)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <SelectBox on={on} className="border-[var(--border)] bg-[var(--background)]" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{lorebook.name}</span>
                      {lorebook.description && (
                        <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                          {lorebook.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {form.sourceLorebookIds.length > 0 && (
        <p className={NOTE}>Fixed selections override chat-active lorebooks for every chat that uses this agent.</p>
      )}
      {router && (form.sourceLorebookIds.length > 0 || chatActive) && (
        <p className={cn(NOTE, "italic")}>
          Tip: entries without a description fall back to a short content snippet. Adding tight one-line descriptions to
          your most important entries improves routing precision.
        </p>
      )}
      {retrieval && (
        <div>
          <span className="mb-1 block text-[0.6875rem] font-medium text-white/60">Files</span>
          {files.length > 0 && (
            <ul className={cn(CAPPED_LIST, "mb-2 border border-white/10 bg-white/[0.02]")}>
              {files.map((file) => {
                const on = form.sourceFileIds.includes(file.id);
                return (
                  <li
                    key={file.id}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border transition-colors",
                      on ? "border-amber-500/20 bg-amber-500/10" : "border-transparent hover:bg-white/5",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => edit((current) => ({ sourceFileIds: toggled(current.sourceFileIds, file.id) }))}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
                    >
                      <SelectBox on={on} className="border-white/20" />
                      <span className="min-w-0">
                        <span className={cn("block truncate text-xs", on ? "text-amber-300" : "text-white/80")}>
                          {file.originalName}
                        </span>
                        <span className="block text-[0.625rem] text-white/40">{(file.size / 1024).toFixed(1)} KB</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Delete file"
                      aria-label="Delete file"
                      onClick={() => editor.deleteFile(file.id)}
                      className="mr-1 shrink-0 rounded-md p-1.5 text-white/20 transition-colors hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 size="0.75rem" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(event) => void editor.uploadFile(event)}
          />
          <button
            type="button"
            disabled={editor.uploading}
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-xs text-white/50 transition-colors hover:border-amber-500/30 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editor.uploading ? (
              <Loader2 size="0.75rem" className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload size="0.75rem" aria-hidden="true" />
            )}
            {editor.uploading ? "Uploading..." : "Upload File"}
          </button>
        </div>
      )}
      {summary && <p className="pt-2 text-[0.625rem] text-white/40">{summary}</p>}
    </FieldGroup>
  );
}
