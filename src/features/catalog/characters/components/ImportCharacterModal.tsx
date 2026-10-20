// ──────────────────────────────────────────────
// Modal: Import Character (JSON / PNG)
// ──────────────────────────────────────────────
import { useRef } from "react";
import { ShieldCheck } from "lucide-react";
import { Modal } from "../../../../shared/components/ui/Modal";
import { useUIStore } from "../../../../shared/stores/ui.store";
import { useCharacterImportFlow } from "../hooks/use-character-import-flow";
import { CharacterImportDropZone } from "./CharacterImportDropZone";
import { CharacterImportLorebookPrompt } from "./CharacterImportLorebookPrompt";
import { CharacterImportOptionsPanel } from "./CharacterImportOptionsPanel";
import { CharacterImportStatusPanel } from "./CharacterImportStatusPanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportCharacterModal({ open, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const openModal = useUIStore((s) => s.openModal);
  const {
    characters,
    status,
    results,
    dragOver,
    dropError,
    pendingLorebookChoice,
    tagImportMode,
    setTagImportMode,
    importMode,
    setImportMode,
    targetCharacterId,
    setTargetCharacterId,
    handleFiles,
    handleDrop,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    reset,
  } = useCharacterImportFlow(open);

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import Character"
    >
      <div className="flex flex-col gap-4">
        {pendingLorebookChoice && (
          <CharacterImportLorebookPrompt
            files={pendingLorebookChoice.files}
            previews={pendingLorebookChoice.previews}
            onChoose={(files, importEmbeddedLorebook) => void handleFiles(files, importEmbeddedLorebook)}
          />
        )}

        <CharacterImportOptionsPanel
          importMode={importMode}
          onImportModeChange={setImportMode}
          targetCharacterId={targetCharacterId}
          onTargetCharacterIdChange={setTargetCharacterId}
          characters={characters}
          tagImportMode={tagImportMode}
          onTagImportModeChange={setTagImportMode}
        />

        <CharacterImportDropZone
          dragOver={dragOver}
          onDrop={handleDrop}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileRef.current?.click()}
        />

        {dropError && (
          <div className="rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">
            {dropError}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".json,.png,.marinara,.charx"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        <CharacterImportStatusPanel status={status} results={results} />

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => {
              reset();
              openModal("card-check");
            }}
            title="Run the import card check on the cards you already have"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <ShieldCheck size="0.875rem" aria-hidden="true" />
            Check my cards
          </button>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
