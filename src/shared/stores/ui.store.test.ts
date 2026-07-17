import { afterEach, describe, expect, it } from "vitest";
import { useUIStore } from "./ui.store";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function resetUiDetails() {
  useUIStore.setState({
    rightPanelOpen: false,
    rightPanel: "chat",
    characterDetailId: null,
    characterDetailDestination: null,
    lorebookDetailId: null,
    presetDetailId: null,
    connectionDetailId: null,
    agentDetailId: null,
    toolDetailId: null,
    personaDetailId: null,
    regexDetailId: null,
    characterLibraryOpen: false,
    botBrowserOpen: false,
    gameAssetsBrowserOpen: false,
    editorDirty: false,
    mobileDetailOriginPanel: null,
  });
}

describe("useUIStore mobile detail routes", () => {
  afterEach(() => {
    setViewportWidth(1024);
    resetUiDetails();
  });

  it("restores the originating right panel when a mobile detail route closes", () => {
    setViewportWidth(390);
    resetUiDetails();
    useUIStore.setState({ rightPanelOpen: true, rightPanel: "bot-browser" });

    useUIStore.getState().openCharacterDetail("char-1");

    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: "char-1",
      rightPanelOpen: false,
      rightPanel: "bot-browser",
      mobileDetailOriginPanel: "bot-browser",
    });

    useUIStore.getState().closeCharacterDetail();

    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: null,
      editorDirty: false,
      rightPanelOpen: true,
      rightPanel: "bot-browser",
      mobileDetailOriginPanel: null,
    });
  });

  it("carries and clears the requested character editor destination", () => {
    useUIStore.getState().openCharacterDetail("char-1", "memories");

    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: "char-1",
      characterDetailDestination: "memories",
    });

    useUIStore.getState().closeCharacterDetail();

    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: null,
      characterDetailDestination: null,
    });
  });

  it("preserves the originating mobile panel when one detail opens another detail", () => {
    setViewportWidth(390);
    resetUiDetails();
    useUIStore.setState({ rightPanelOpen: true, rightPanel: "characters" });

    useUIStore.getState().openCharacterDetail("char-1");
    useUIStore.getState().openLorebookDetail("lorebook-1");
    useUIStore.getState().closeLorebookDetail();

    expect(useUIStore.getState()).toMatchObject({
      characterDetailId: null,
      lorebookDetailId: null,
      rightPanelOpen: true,
      rightPanel: "characters",
      mobileDetailOriginPanel: null,
    });
  });

  it("does not reopen a mobile right panel when the detail was not launched from one", () => {
    setViewportWidth(390);
    resetUiDetails();

    useUIStore.getState().openLorebookDetail("lorebook-1");
    useUIStore.getState().closeLorebookDetail();

    expect(useUIStore.getState()).toMatchObject({
      lorebookDetailId: null,
      rightPanelOpen: false,
      mobileDetailOriginPanel: null,
    });
  });
});

describe("useUIStore conversation message style", () => {
  afterEach(() => {
    useUIStore.setState({ conversationMessageStyle: "classic" });
  });

  it("stores bubble layout selections", () => {
    useUIStore.getState().setConversationMessageStyle("bubble");

    expect(useUIStore.getState().conversationMessageStyle).toBe("bubble");
  });

  it("normalizes unknown layout selections to classic", () => {
    useUIStore.getState().setConversationMessageStyle("compact" as never);

    expect(useUIStore.getState().conversationMessageStyle).toBe("classic");
  });
});
