import { useState } from "react";
import { Maximize2 } from "lucide-react";

import type { CharacterData } from "../../../../engine/contracts/types/character";
import { ExpandedTextarea } from "../../../../shared/components/ui/ExpandedTextarea";
import { CharacterEditorSectionHeader as SectionHeader } from "./CharacterEditorSectionHeader";

export function CharacterDescriptionTab({
  formData,
  updateField,
}: {
  formData: CharacterData;
  updateField: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
}) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-2 mb-4">
          <SectionHeader
            title="Description"
            subtitle="The character's general description. This is sent in every prompt as part of the character's identity."
          />
          <button
            type="button"
            onClick={() => setDescriptionExpanded(true)}
            className="mt-0.5 shrink-0 rounded-lg p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.875rem" />
          </button>
        </div>
        <textarea
          value={formData.description}
          onChange={(event) => updateField("description", event.target.value)}
          placeholder="Describe who this character is, their role, and their key traits…"
          rows={12}
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 text-sm leading-relaxed outline-none transition-colors placeholder:text-[var(--muted-foreground)]/40 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
        />
        <p className="mt-1.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">
          {formData.description.length} characters
        </p>
      </div>

      <ExpandedTextarea
        open={descriptionExpanded}
        onClose={() => setDescriptionExpanded(false)}
        title="Description"
        value={formData.description}
        onChange={(value) => updateField("description", value)}
        placeholder="Describe who this character is, their role, and their key traits…"
      />
    </div>
  );
}
