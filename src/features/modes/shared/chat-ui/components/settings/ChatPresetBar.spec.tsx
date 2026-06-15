import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPresetBar } from "./ChatPresetBar";

describe("ChatPresetBar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  it("keeps Save As available when no preset is selected", () => {
    act(() => {
      root = createRoot(container!);
      root.render(
        <ChatPresetBar
          fileInputRef={createRef<HTMLInputElement>()}
          isConversation={false}
          presetList={[]}
          selectedChatPreset={null}
          selectedChatPresetIsActive={false}
          selectedChatPresetIsDefault={false}
          renamingPreset={false}
          renamePresetVal=""
          defaultTogglePending={false}
          onImportFile={vi.fn()}
          onRenamePresetValChange={vi.fn()}
          onCommitRenamePreset={vi.fn()}
          onCancelRenamePreset={vi.fn()}
          onSelectPreset={vi.fn()}
          onToggleDefaultPreset={vi.fn()}
          onSaveIntoPreset={vi.fn()}
          onStartRenamePreset={vi.fn()}
          onSaveAsPreset={vi.fn()}
          onImportClick={vi.fn()}
          onExportPreset={vi.fn()}
          onDeletePreset={vi.fn()}
        />,
      );
    });

    const saveAs = container!.querySelector<HTMLButtonElement>(
      'button[title="Save current chat settings as a new preset"]',
    );
    expect(saveAs).not.toBeNull();
    expect(saveAs?.disabled).toBe(false);
  });
});
