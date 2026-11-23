import type { ReactNode } from "react";
import type { WrapFormat } from "../../../../../engine/contracts/types/prompt";
import { PresetSectionsTab } from "../preset-sections";
import { EditorBars } from "./EditorBars";
import { EditorHeader } from "./EditorHeader";
import { OverviewTab } from "./OverviewTab";
import { TabRail } from "./TabRail";
import { usePresetEditor, type PresetEditorModel } from "./use-preset-editor";

// The preset editor shell (docs/provenance/preset-overview.md): loading and not-found states, the header, the bars,
// the tab rail and the tab content. The Sections tab is its own module; the AI Review tab comes from the caller.

export interface PresetEditorShellProps {
  /** Called while the AI Review tab is active; its result goes straight into the content column. */
  renderReviewTab: (presetId: string) => ReactNode;
}

export function PresetEditorShell({ renderReviewTab }: PresetEditorShellProps) {
  const editor = usePresetEditor();
  const { presetDetailId, data } = editor;

  if (!presetDetailId) return null;
  if (editor.loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer h-4 w-32 rounded-lg" />
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Preset not found
      </div>
    );
  }

  return (
    <div className="@container flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <EditorHeader editor={editor} />
      <EditorBars editor={editor} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden @5xl:flex-row">
        <TabRail tab={editor.tab} onSelect={editor.setTab} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 @5xl:p-6">
          <div className="mx-auto max-w-2xl space-y-6">
            <TabContent editor={editor} presetId={presetDetailId} renderReviewTab={renderReviewTab} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabContent({
  editor,
  presetId,
  renderReviewTab,
}: { editor: PresetEditorModel; presetId: string } & PresetEditorShellProps) {
  switch (editor.tab) {
    case "overview":
      return (
        <OverviewTab
          draft={editor.draft}
          onEdit={editor.edit}
          sectionCount={editor.sections.length}
          groupCount={editor.data?.groups.length ?? 0}
        />
      );
    case "sections":
      return (
        <PresetSectionsTab
          presetId={presetId}
          sections={editor.sections}
          groupMap={editor.groupMap}
          choiceBlocks={editor.choiceBlocks}
          wrapFormat={editor.draft.wrapFormat as WrapFormat}
          {...editor.mutations}
          hasLorebookMarker={editor.hasLorebookMarker}
          parentChatHasLorebook={editor.parentChatHasLorebook}
        />
      );
    case "review":
      return renderReviewTab(presetId);
  }
}
