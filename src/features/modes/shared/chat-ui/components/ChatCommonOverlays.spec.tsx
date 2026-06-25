import { Component, type ErrorInfo, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatCommonOverlays } from "./ChatCommonOverlays";

vi.mock("../../../../runtime/visuals/index", () => ({
  PinnedImageOverlay: () => null,
}));

vi.mock("./ChatSetupWizard", () => {
  throw new TypeError(
    "Failed to fetch dynamically imported module: http://pi:7860/assets/ChatSetupWizard-B6ustY6j.js",
  );
});

class OuterBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(_error: unknown, _errorInfo: ErrorInfo) {}

  render() {
    if (this.state.error) return <div data-testid="outer-crash">Outer crash</div>;
    return this.props.children;
  }
}

function flushLazyImport() {
  return act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function renderWizardOverlay() {
  return (
    <OuterBoundary>
      <ChatCommonOverlays
        chat={{ id: "chat-1", name: "Test chat" } as never}
        activeChatId="chat-1"
        settingsOpen={false}
        filesOpen={false}
        galleryOpen={false}
        wizardOpen={true}
        peekPromptData={null}
        deleteDialogMessageId={null}
        deleteDialogCanDeleteSwipe={false}
        deleteDialogActiveSwipeIndex={0}
        deleteDialogSwipeCount={0}
        multiSelectMode={false}
        selectedMessageCount={0}
        sceneSettings={{
          spriteArrangeMode: false,
          onToggleSpriteArrange: vi.fn(),
          onResetSpritePlacements: vi.fn(),
          onSpriteSideChange: vi.fn(),
        }}
        onCloseSettings={vi.fn()}
        onCloseFiles={vi.fn()}
        onCloseGallery={vi.fn()}
        onWizardFinish={vi.fn()}
        onWizardCancel={vi.fn()}
        onClosePeekPrompt={vi.fn()}
        onDeleteConfirm={vi.fn()}
        onDeleteSwipe={vi.fn()}
        onDeleteMore={vi.fn()}
        onCloseDeleteDialog={vi.fn()}
        onBulkDelete={vi.fn()}
        onCancelMultiSelect={vi.fn()}
        onUnselectAllMessages={vi.fn()}
        onSelectAllAboveSelection={vi.fn()}
        onSelectAllBelowSelection={vi.fn()}
      />
    </OuterBoundary>
  );
}

describe("ChatCommonOverlays", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    vi.clearAllMocks();
  });

  it("contains setup wizard chunk load failures inside the overlay layer", async () => {
    await act(async () => {
      root = createRoot(container!);
      root.render(renderWizardOverlay());
    });

    await flushLazyImport();

    expect(container!.querySelector("[data-testid='outer-crash']")).toBeNull();
    expect(container!.textContent).toContain("Could not open setup");
    expect(container!.textContent).toContain("Reload De-Koi");
  });
});
